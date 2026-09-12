/**
 * Community crash corpus: the consumer side of the --share data flywheel.
 * loadCrashCorpus degrades like every network path here (null on any
 * failure, never blocks the verdict); runDiagnosis cross-checks crash-level
 * findings against it and the renderer shows the hit under the finding.
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { runDiagnosis } from '../lib/diagnose.mjs'
import { loadCrashCorpus } from '../lib/net.mjs'
import { renderText } from '../lib/report.mjs'
import { buildSharePayloads, findingSig } from '../lib/share.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const ENV = {
  DSH_HOME: join(FIXTURES, 'dsh-home'),
  DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global'),
  DSH_WHY_PROFILE: 'web',
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

// The fixture 'web' profile always crashes on R1 (fake-crash-plugin misses
// @deepseek-ai/dsh-client-runtime/client) — precompute the sig --share sends.
const CRASH_FINDING = { rule: 'R1', severity: 'error', plugin: 'fake-crash-plugin', missing: ['@deepseek-ai/dsh-client-runtime/client'] }
const CRASH_SIG = findingSig(CRASH_FINDING)

const CORPUS = {
  generatedAt: '2026-09-12T00:00:00Z',
  totalReports: 9,
  signatures: [
    {
      sig: CRASH_SIG,
      category: 'module-missing',
      count: 5,
      plugins: ['fake-crash-plugin'],
      shells: ['0.1.2-rc.1'],
      firstSeen: '2026-09-01T08:00:00Z',
      lastSeen: '2026-09-11T12:34:56Z',
    },
  ],
}

describe('findingSig', () => {
  it('is deterministic and identical to the sig --share sends', () => {
    assert.equal(findingSig(CRASH_FINDING), findingSig(structuredClone(CRASH_FINDING)))
    const report = { install: { shellVersion: '0.1.2-rc.1' }, findings: [CRASH_FINDING] }
    assert.equal(buildSharePayloads(report)[0].sig, CRASH_SIG)
    assert.match(CRASH_SIG, /^r1_[0-9a-f]{16}$/)
  })
})

describe('loadCrashCorpus', () => {
  it('returns the corpus document when the upstream serves it', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => CORPUS })
    const doc = await loadCrashCorpus({ offline: false })
    assert.equal(doc.totalReports, 9)
    assert.equal(doc.signatures[0].sig, CRASH_SIG)
  })

  it('offline mode never touches the network and returns null', async () => {
    let calls = 0
    globalThis.fetch = () => { calls++; throw new Error('network must not be called offline') }
    assert.equal(await loadCrashCorpus({ offline: true }), null)
    assert.equal(calls, 0)
  })

  it('degrades to null on unreachable upstreams and malformed documents', async () => {
    globalThis.fetch = async () => { throw new Error('ENOTFOUND') }
    assert.equal(await loadCrashCorpus({ offline: false }), null)

    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => null })
    assert.equal(await loadCrashCorpus({ offline: false }), null)

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ generatedAt: '2026-09-12T00:00:00Z' }) })
    assert.equal(await loadCrashCorpus({ offline: false }), null) // no signatures array
  })
})

describe('runDiagnosis × crash corpus', () => {
  it('a sig hit attaches corpusHit and renders the community line (en + zh)', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('crash-corpus')) return { ok: true, json: async () => CORPUS }
      return { ok: false, status: 404, json: async () => null }
    }
    const report = await runDiagnosis({ env: ENV, offline: false })
    const r1 = report.findings.find((f) => f.rule === 'R1' && f.severity === 'error')
    assert.deepEqual(r1.corpusHit, { sig: CRASH_SIG, count: 5, lastSeen: '2026-09-11T12:34:56Z' })
    // --json consumers get the same object, so the hit is machine-readable
    assert.equal(JSON.parse(JSON.stringify(report)).findings.find((f) => f.corpusHit).corpusHit.count, 5)

    const en = renderText(report, 'en', '9.9.9', { color: false })
    assert.match(en, /Community corpus: 5 report\(s\) of this exact crash \(latest 2026-09-11\) · --share adds yours/)
    const zh = renderText(report, 'zh', '9.9.9', { color: false })
    assert.match(zh, /社区语料：已见 5 例上报（最近 2026-09-11）· --share 可上报你的案例/)
  })

  it('a sig miss renders no community line', async () => {
    const otherOnly = { ...CORPUS, signatures: [{ sig: 'r6_0000000000000000', category: 'profile-boot', count: 3, plugins: ['x'], shells: ['0.1.2-rc.1'], firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-09-10T00:00:00Z' }] }
    globalThis.fetch = async (url) => {
      if (String(url).includes('crash-corpus')) return { ok: true, json: async () => otherOnly }
      return { ok: false, status: 404, json: async () => null }
    }
    const report = await runDiagnosis({ env: ENV, offline: false })
    const r1 = report.findings.find((f) => f.rule === 'R1' && f.severity === 'error')
    assert.equal(r1.corpusHit, undefined)
    assert.doesNotMatch(renderText(report, 'en', '9.9.9', { color: false }), /Community corpus/)
    assert.doesNotMatch(renderText(report, 'zh', '9.9.9', { color: false }), /社区语料/)
  })

  it('an unreachable corpus degrades the diagnosis, never crashes it', async () => {
    globalThis.fetch = async () => { throw new Error('ENOTFOUND') }
    const report = await runDiagnosis({ env: ENV, offline: false })
    assert.equal(report.summary.errors, 1) // R1 still fires on the bundled table
    const r1 = report.findings.find((f) => f.rule === 'R1' && f.severity === 'error')
    assert.equal(r1.corpusHit, undefined)
    assert.doesNotMatch(renderText(report, 'en', '9.9.9', { color: false }), /Community corpus/)
  })

  it('offline mode skips the corpus entirely', async () => {
    let calls = 0
    globalThis.fetch = () => { calls++; throw new Error('network must not be called offline') }
    const report = await runDiagnosis({ env: ENV, offline: true })
    assert.equal(calls, 0)
    const r1 = report.findings.find((f) => f.rule === 'R1' && f.severity === 'error')
    assert.equal(r1.corpusHit, undefined)
  })
})
