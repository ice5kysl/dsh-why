/**
 * --error / stdin mode: the error-pattern parser plus the reference
 * diagnosis (runDiagnosis with errorText, stubbed network — no real fetches).
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { runDiagnosis } from '../lib/diagnose.mjs'
import { knownPatterns, parseErrorText } from '../lib/errparse.mjs'
import { buildFixPrompt, renderText } from '../lib/report.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const ENV = {
  DSH_HOME: join(FIXTURES, 'dsh-home'),
  DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global'),
  DSH_WHY_PROFILE: 'web',
}

// The verbatim acceptance sample.
const SAMPLE = 'HARNESS Failed to load plugins: failed to import loader entry f059e6c1 (dsh-workspace-kit): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function stubOnline() {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('shell-seeds')) {
      const { readFileSync } = await import('node:fs')
      return { ok: true, json: async () => JSON.parse(readFileSync(new URL('../lib/data/shell-seeds.json', import.meta.url), 'utf8')) }
    }
    if (u.includes('compat-observed')) {
      return {
        ok: true,
        json: async () => ({
          plugins: {
            'dsh-workspace-kit': {
              repo: 'ice5kysl/dsh-workspace-kit',
              version: '0.13.1',
              requires: ['@deepseek-ai/dsh-client-store'],
              results: { '0.1.2-rc.1': { status: 'ok' } },
              verdict: { cls: 'supported-since', since: '0.1.2-alpha.2', total: 15 },
            },
          },
        }),
      }
    }
    if (u.includes('fixes.json')) {
      return {
        ok: true,
        json: async () => ({
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
    return { ok: false, status: 404, json: async () => null }
  }
}

describe('parseErrorText', () => {
  it('parses the combined loader-entry + missed-module-table sample', () => {
    const refs = parseErrorText(SAMPLE)
    assert.equal(refs.recognized, true)
    assert.deepEqual(refs.plugins, ['dsh-workspace-kit'])
    assert.deepEqual(refs.modules, ['@deepseek-ai/dsh-client-runtime/client'])
    assert.ok(refs.matched.includes('loader-entry'))
    assert.ok(refs.matched.includes('missed-module-table'))
  })

  it('parses bundle-script failures (scoped and unscoped)', () => {
    const refs = parseErrorText('client-modules: bundle script /plugins/dshmarket/client.js failed to load')
    assert.deepEqual(refs.plugins, ['dshmarket'])
    const scoped = parseErrorText('bundle script /plugins/%40scope%2Fname/client.js failed to load')
    assert.deepEqual(scoped.plugins, ['@scope/name'])
  })

  it('parses the cannot-resolve async twin', () => {
    const refs = parseErrorText('client-modules: cannot resolve "@deepseek-ai/dsh-client-ui-attachment" — not a seed word')
    assert.deepEqual(refs.modules, ['@deepseek-ai/dsh-client-ui-attachment'])
  })

  it('bare "Failed to load plugins" → bare fallback, no refs', () => {
    const refs = parseErrorText('HARNESS Failed to load plugins')
    assert.equal(refs.recognized, false)
    assert.equal(refs.bare, true)
  })

  it('unknown text → neither recognized nor bare', () => {
    const refs = parseErrorText('TypeError: Cannot read properties of undefined')
    assert.equal(refs.recognized, false)
    assert.equal(refs.bare, false)
    assert.ok(knownPatterns().length >= 4)
  })
})

describe('runDiagnosis with errorText', () => {
  it('recognized refs: diagnoses objects NOT installed locally, with matrix + known fixes', async () => {
    stubOnline()
    const report = await runDiagnosis({ env: ENV, errorText: SAMPLE })
    assert.deepEqual(report.errorRefs.plugins, ['dsh-workspace-kit'])
    assert.deepEqual(report.errorRefs.modules, ['@deepseek-ai/dsh-client-runtime/client'])
    assert.equal(report.plugins.length, 0) // profile never scanned

    const r1 = report.findings.find((f) => f.rule === 'R1')
    assert.equal(r1.plugin, 'dsh-workspace-kit')
    assert.deepEqual(r1.missing, ['@deepseek-ai/dsh-client-runtime/client'])
    assert.equal(r1.severity, 'error')
    assert.equal(r1.resolvableNow, false)
    assert.equal(r1.history['@deepseek-ai/dsh-client-runtime/client'].kind, 'never')
    assert.ok(r1.knownFixes['@deepseek-ai/dsh-client-runtime/client'].fix.includes('dsh-client-store'))
    assert.equal(r1.observed.verdict, 'supported-since')

    const r4 = report.findings.find((f) => f.rule === 'R4')
    assert.equal(r4.plugin, 'dsh-workspace-kit')
    assert.equal(r4.severity, 'note') // matrix says ok at this shell — the error predates a fix
    assert.equal(report.summary.errors, 1)
  })

  it('text render shows the parsed refs, matrix cross-check and known fixes (zh)', async () => {
    stubOnline()
    const report = await runDiagnosis({ env: ENV, errorText: SAMPLE })
    const out = renderText(report, 'zh', '0.1.2', { color: false })
    assert.match(out, /报错解析/)
    assert.match(out, /识别到插件：dsh-workspace-kit/)
    assert.match(out, /识别到模块：@deepseek-ai\/dsh-client-runtime\/client/)
    assert.match(out, /生态对照/)
    assert.match(out, /已知修法（来自生态案例库）/)
    assert.match(out, /Fisfzy\/dsh-ego-browser/)
    assert.match(out, /仅 dsh >= 0\.1\.2-alpha\.2 可加载/)
  })

  it('error mode stays fully functional offline (bundled rule base, zero network)', async () => {
    let calls = 0
    globalThis.fetch = () => { calls++; throw new Error('offline') }
    const report = await runDiagnosis({ env: ENV, errorText: SAMPLE, offline: true })
    assert.equal(calls, 0)
    const r1 = report.findings.find((f) => f.rule === 'R1')
    assert.equal(r1.severity, 'error')
    assert.equal(r1.knownFixes, undefined) // no fixes.json offline
    assert.equal(report.findings.filter((f) => f.rule === 'R4').length, 0)
  })

  it('bare error falls back to the full diagnosis with a marker', async () => {
    globalThis.fetch = () => { throw new Error('offline') }
    const report = await runDiagnosis({ env: ENV, errorText: 'HARNESS Failed to load plugins', offline: true })
    assert.equal(report.bareErrorFallback, true)
    assert.equal(report.pluginCount, 3) // the web fixture profile — a FULL diagnosis ran
    assert.equal(report.summary.errors, 1)
  })

  it('unrecognized error: honest answer, exit-safe (no error findings)', async () => {
    const report = await runDiagnosis({ env: ENV, errorText: 'Segfault at 0xdeadbeef', offline: true })
    assert.ok(report.unrecognizedError)
    assert.equal(report.summary.errors, 0)
    const out = renderText(report, 'zh', '0.1.2', { color: false })
    assert.match(out, /暂不认识这个报错模式/)
    assert.match(out, /missed the module table/)
    assert.match(out, /github\.com\/ice5kysl\/dsh-why\/issues/)
  })

  it('a module that resolves on the current shell is reported as self-healed, not a crash', async () => {
    stubOnline()
    const report = await runDiagnosis({ env: ENV, errorText: 'require("react") missed the module table' })
    const r1 = report.findings.find((f) => f.rule === 'R1')
    assert.equal(r1.severity, 'warning')
    assert.equal(r1.resolvableNow, true)
    assert.equal(report.summary.errors, 0)
  })
})

describe('buildFixPrompt', () => {
  it('contains environment, findings, known fixes and the seed-safe constraint (zh)', async () => {
    stubOnline()
    const report = await runDiagnosis({ env: ENV, errorText: SAMPLE })
    const prompt = buildFixPrompt(report, 'zh', '0.1.2')
    assert.match(prompt, /修复 dsh（DeepSeek Harness）插件加载失败/)
    assert.match(prompt, /dsh：0\.1\.2-rc\.1/)
    assert.match(prompt, /dsh-client-runtime\/client/)
    assert.match(prompt, /迁移到 @deepseek-ai\/dsh-client-store/)
    assert.match(prompt, /seed-safe/)
    assert.match(prompt, /try\/catch/)
    assert.match(prompt, /npx dsh-why/)
  })

  it('renders in English too', async () => {
    stubOnline()
    const report = await runDiagnosis({ env: ENV, errorText: SAMPLE })
    const prompt = buildFixPrompt(report, 'en', '0.1.2')
    assert.match(prompt, /Fix a dsh \(DeepSeek Harness\) plugin load failure/)
    assert.match(prompt, /Known fixes/)
    assert.match(prompt, /seed-safe only/)
  })

  it('returns null when nothing is actionable (healthy report)', async () => {
    globalThis.fetch = () => { throw new Error('offline') }
    const report = await runDiagnosis({ env: { ...ENV, DSH_WHY_PROFILE: 'clean' }, offline: true })
    assert.equal(buildFixPrompt(report, 'zh', '0.1.2'), null)
  })
})
