/**
 * Orchestration tests: runDiagnosis with the network layer trapped —
 * --offline must make zero fetch calls; "online" uses a stubbed fetch, so
 * the suite never touches a real network.
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { runDiagnosis } from '../lib/diagnose.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const ENV = {
  DSH_HOME: join(FIXTURES, 'dsh-home'),
  DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global'),
  DSH_WHY_PROFILE: 'web',
}

const OBSERVED_FIXTURE = {
  generatedAt: '2026-09-10T00:00:00Z',
  plugins: {
    'fake-crash-plugin': {
      repo: 'example/fake-crash-plugin',
      version: '1.0.0',
      requires: ['@deepseek-ai/dsh-client-runtime/client'],
      results: { '0.1.2-rc.1': { status: 'broken', missing: ['@deepseek-ai/dsh-client-runtime/client'] } },
      verdict: { cls: 'never', total: 15 },
    },
  },
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('runDiagnosis', () => {
  it('offline mode never touches the network and still produces a full report', async () => {
    let calls = 0
    globalThis.fetch = () => { calls++; throw new Error('network must not be called offline') }
    const report = await runDiagnosis({ env: ENV, offline: true })
    assert.equal(calls, 0)
    assert.equal(report.mode, 'offline')
    assert.equal(report.summary.errors, 1)
    assert.equal(report.degraded, false)
    const r1 = report.findings.find((f) => f.rule === 'R1' && f.severity === 'error')
    assert.equal(r1.knownFixes, undefined) // fixes.json is an online-only source
  })

  it('online mode engages R3/R4 via the stubbed upstreams', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('shell-seeds')) {
        const { readFileSync } = await import('node:fs')
        const doc = JSON.parse(readFileSync(new URL('../lib/data/shell-seeds.json', import.meta.url), 'utf8'))
        return { ok: true, json: async () => doc }
      }
      if (u.includes('compat-observed')) return { ok: true, json: async () => OBSERVED_FIXTURE }
      if (u.includes('fixes.json')) {
        return {
          ok: true,
          json: async () => ({
            generatedAt: '2026-09-10T00:00:00.000Z',
            modules: {
              '@deepseek-ai/dsh-client-runtime/client': {
                status: 'never-seeded',
                fix: '迁移到 @deepseek-ai/dsh-client-store',
                cases: [{ repo: 'Fisfzy/dsh-ego-browser', url: 'https://github.com/Fisfzy/dsh-ego-browser/issues/32', note: '已修待 publish' }],
              },
            },
          }),
        }
      }
      if (u.includes('registry.npmjs.org/fake-crash-plugin')) return { ok: true, json: async () => ({ version: '1.1.0' }) }
      if (u.includes('registry.npmjs.org')) return { ok: true, json: async () => ({ version: '0.0.0' }) }
      return { ok: false, status: 404, json: async () => null }
    }
    const report = await runDiagnosis({ env: ENV, offline: false })
    assert.equal(report.mode, 'online')
    assert.equal(report.degraded, false)
    assert.equal(report.seed.origin, 'upstream')
    const r1 = report.findings.find((f) => f.rule === 'R1' && f.severity === 'error')
    assert.equal(r1.observed.verdict, 'never')
    assert.equal(r1.upgradeAvailable, true) // R3's 1.1.0 > 1.0.0 folded into the R1 fix hints
    assert.ok(report.findings.some((f) => f.rule === 'R5' && f.plugin === 'fake-guarded-plugin'))
    // fixes.json hit → known-fix block on the R1 finding
    assert.equal(r1.knownFixes['@deepseek-ai/dsh-client-runtime/client'].cases[0].repo, 'Fisfzy/dsh-ego-browser')
  })

  it('unreachable upstreams degrade to the bundled rule base, never to a crash', async () => {
    globalThis.fetch = async () => { throw new Error('ENOTFOUND') }
    const report = await runDiagnosis({ env: ENV, offline: false })
    assert.equal(report.degraded, true)
    assert.equal(report.seed.origin, 'bundled')
    assert.equal(report.summary.errors, 1) // R1 still fires on the bundled table
  })
})
