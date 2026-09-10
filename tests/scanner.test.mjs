/**
 * Scanner tests: the guard-aware require extractor ported from
 * dsh-insights compat-observed, plus statusFor verdict semantics.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { classify, compareVersions, extractRequiresV2, rowIndex, statusFor, stripClientSuffix } from '../lib/scanner.mjs'

const SEED = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store'])
const NO_KNOWN = new Set()

function guards(bundle) {
  return extractRequiresV2(bundle).requiresV2
}

const v2of = (bundle) => extractRequiresV2(bundle).requiresV2

describe('extractRequiresV2', () => {
  it('extracts flat literal requires, deduped, in order', () => {
    const { requires, requiresV2 } = extractRequiresV2(`
      var a = require("react");
      var b = require("react/jsx-runtime");
      var c = require("react");
      var d = __require("@scope/pkg/client");
    `)
    assert.deepEqual(requires, ['react', 'react/jsx-runtime', '@scope/pkg/client'])
    assert.deepEqual(requiresV2.map((r) => r.spec), requires)
    assert.ok(requiresV2.every((r) => r.guard === 'unguarded'))
  })

  it('excludes template-string requires (statically undecidable)', () => {
    const { requires } = extractRequiresV2('const x = require(`./chunks/${name}.js`); require("react")')
    assert.deepEqual(requires, ['react'])
  })

  it('labels try/catch guard context', () => {
    const v2 = guards(`
      try { require("in-try-mod") } catch (e) { require("in-catch-mod") }
      require("bare-mod")
    `)
    const bySpec = Object.fromEntries(v2.map((r) => [r.spec, r]))
    assert.equal(bySpec['in-try-mod'].guard, 'in-try')
    assert.equal(bySpec['in-catch-mod'].guard, 'in-catch')
    assert.equal(bySpec['in-try-mod'].pair, bySpec['in-catch-mod'].pair)
    assert.equal(bySpec['bare-mod'].guard, 'unguarded')
  })

  it('handles minified bundles (no whitespace anywhere)', () => {
    const v2 = guards(`!function(){"use strict";try{a(require("x-mod"))}catch(e){require("y-mod")}require("z-mod")}()`)
    const bySpec = Object.fromEntries(v2.map((r) => [r.spec, r]))
    assert.equal(bySpec['x-mod'].guard, 'in-try')
    assert.equal(bySpec['y-mod'].guard, 'in-catch')
    assert.equal(bySpec['z-mod'].guard, 'unguarded')
  })

  it('nested try pairs keep innermost guard regions', () => {
    const v2 = guards(`
      try {
        try { require("inner-missing") } catch (e) { require("inner-fallback") }
        require("outer-require")
      } catch (e) { require("outer-fallback") }
    `)
    const bySpec = Object.fromEntries(v2.map((r) => [r.spec, r]))
    assert.equal(bySpec['inner-missing'].guard, 'in-try')
    assert.equal(bySpec['inner-fallback'].guard, 'in-catch')
    assert.equal(bySpec['inner-missing'].pair, bySpec['inner-fallback'].pair)
    assert.equal(bySpec['outer-require'].guard, 'in-try')
    assert.equal(bySpec['outer-fallback'].guard, 'in-catch')
    assert.notEqual(bySpec['inner-missing'].pair, bySpec['outer-require'].pair)
  })

  it('a try without catch (finally / bare) counts as unguarded — the exception escapes', () => {
    const v2 = guards(`
      try { require("finally-mod") } finally { cleanup() }
      try { require("bare-try-mod") }
    `)
    const bySpec = Object.fromEntries(v2.map((r) => [r.spec, r]))
    assert.equal(bySpec['finally-mod'].guard, 'unguarded')
    assert.equal(bySpec['bare-try-mod'].guard, 'unguarded')
  })

  it('string/comment/regex literals carrying try/catch braces do not disturb pairing', () => {
    const v2 = guards(`
      var help = "try { this } catch { that }";
      var tpl = \`x \${ ok ? "}" : "{" } y\`;
      // try { require("comment-decoy") } catch {}
      /* catch { also a decoy } */
      var re = /[{}]/.test(s);
      var re2 = s.replace(/}/g, '{');
      try { require("guarded-mod") } catch (e) { require("fallback-mod") }
      require("bare-mod")
    `)
    const bySpec = Object.fromEntries(v2.map((r) => [r.spec, r]))
    assert.equal(bySpec['guarded-mod'].guard, 'in-try')
    assert.equal(bySpec['fallback-mod'].guard, 'in-catch')
    assert.equal(bySpec['bare-mod'].guard, 'unguarded')
    // comment-decoy sits in a comment: code-state extraction never sees it
    assert.equal(bySpec['comment-decoy'], undefined)
  })

  it('catch params with destructuring and defaults pair correctly', () => {
    const v2 = guards(`
      try { require("a-mod") } catch ({ message = "}" } = {}) { require("b-mod") }
    `)
    const bySpec = Object.fromEntries(v2.map((r) => [r.spec, r]))
    assert.equal(bySpec['a-mod'].guard, 'in-try')
    assert.equal(bySpec['b-mod'].guard, 'in-catch')
  })
})

describe('statusFor (guard-aware verdicts)', () => {
  // A read install tree that mounts no client rows: "not a seed word and not a
  // row" is then genuinely missing. (rows === null means "unreadable", which is
  // the degraded 'unknown' mode tested further down.)
  const NO_ROWS = { immediate: new Set(), lazy: new Set() }

  it('unguarded missing → broken', () => {
    const r = statusFor(v2of('require("react"); require("gone-mod")'), SEED, 'self', NO_KNOWN, NO_ROWS)
    assert.equal(r.status, 'broken')
    assert.deepEqual(r.missing, ['gone-mod'])
  })

  it('seed words and own package name resolve', () => {
    const r = statusFor(v2of('require("react"); require("self/client")'), SEED, 'self', NO_KNOWN, NO_ROWS)
    assert.equal(r.status, 'ok')
  })

  it('known plugin packages resolve via the /client strip (registered factory)', () => {
    const r = statusFor(v2of('require("other-plugin/client")'), SEED, 'self', new Set(['other-plugin']), NO_ROWS)
    assert.equal(r.status, 'ok')
  })

  it('try-miss with resolvable catch → ok (fallback path works)', () => {
    const r = statusFor(v2of('try { require("gone-mod") } catch (e) { require("react") }'), SEED, 'self', NO_KNOWN, NO_ROWS)
    assert.equal(r.status, 'ok')
  })

  it('try-miss with empty catch → ok (graceful degradation)', () => {
    const r = statusFor(v2of('try { require("gone-mod") } catch (e) {}'), SEED, 'self', NO_KNOWN, NO_ROWS)
    assert.equal(r.status, 'ok')
  })

  it('try-miss with catch-miss → broken, both sides listed', () => {
    const r = statusFor(v2of('try { require("gone-a") } catch (e) { require("gone-b") }'), SEED, 'self', NO_KNOWN, NO_ROWS)
    assert.equal(r.status, 'broken')
    assert.deepEqual(r.missing, ['gone-a', 'gone-b'])
  })
})

describe('compareVersions / stripClientSuffix', () => {
  it('orders numeric segments, then prerelease tag and number; release > prerelease', () => {
    const sorted = ['0.1.2-rc.1', '0.0.1-rc.5', '0.1.2-alpha.2', '0.1.2', '0.1.10-alpha.1', '0.1.2-alpha.10'].sort(compareVersions)
    assert.deepEqual(sorted, ['0.0.1-rc.5', '0.1.2-alpha.2', '0.1.2-alpha.10', '0.1.2-rc.1', '0.1.2', '0.1.10-alpha.1'])
  })

  it('strips only a trailing /client', () => {
    assert.equal(stripClientSuffix('@scope/pkg/client'), '@scope/pkg')
    assert.equal(stripClientSuffix('@scope/pkg/client/client'), '@scope/pkg/client')
    assert.equal(stripClientSuffix('react'), 'react')
    assert.equal(stripClientSuffix('some/clientish'), 'some/clientish')
  })
})

// 2026-09-10 accuracy fixes (ecosystem review): code-state-only extraction,
// relative-spec exclusion, and the graph-row resolution tier.
describe('code-state extraction + local module tables', () => {
  it('requires inside comments and strings are never extracted', () => {
    const { requires, requiresV2 } = extractRequiresV2(`
      // require("lodash") kept for reference
      /* require("left-pad") */
      var doc = "require(\\"dayjs\\")";
      var tpl = \`see require("ns-\${x}") pattern\`;
      require("react");
    `)
    assert.deepEqual(requires, ['react'])
    assert.deepEqual(requiresV2.map((r) => r.spec), ['react'])
  })

  it('relative/absolute specifiers are excluded and counted as local (localRequire bundles)', () => {
    // The dsh-safe-delete / dsh-web-mobile bundle shape: a local module table
    // serves "./x.js" — such requires never reach the dsh loader.
    const { requires, requiresV2, local } = extractRequiresV2(`
      var modules = { './i18n.js': function (module, exports, require) {} };
      function localRequire(name) { var l = modules[name]; if (l === undefined) return require(name); }
      localRequire("./i18n.js");
      require("./effects/phone-chrome.js");
      require("/abs/path.js");
      require("react");
    `)
    assert.deepEqual(requires, ['react'])
    assert.deepEqual(requiresV2.map((r) => r.spec), ['react'])
    assert.equal(local, 2) // ./effects + /abs（localRequire("./i18n.js") 走的是 localRequire，不计）
  })
})

describe('graph-row classification (seed → factory branches)', () => {
  const ROWS = {
    immediate: new Set(['@deepseek-ai/dsh-client-connection']),
    lazy: new Set(['@deepseek-ai/dsh-client-ui-attachment']),
  }

  it('immediate rows classify ok without any declaration', () => {
    assert.equal(classify('@deepseek-ai/dsh-client-connection', SEED, 'self', NO_KNOWN, ROWS), 'ok')
    assert.equal(classify('@deepseek-ai/dsh-client-connection/client', SEED, 'self', NO_KNOWN, ROWS), 'ok')
  })

  it('lazy rows are conditional unless declared in dsh.client external/inject', () => {
    assert.equal(classify('@deepseek-ai/dsh-client-ui-attachment', SEED, 'self', NO_KNOWN, ROWS), 'conditional')
    assert.equal(classify('@deepseek-ai/dsh-client-ui-attachment', SEED, 'self', NO_KNOWN, ROWS, new Set(['@deepseek-ai/dsh-client-ui-attachment'])), 'ok')
  })

  it('never-shipped modules classify missing', () => {
    assert.equal(classify('@deepseek-ai/dsh-client-runtime/client', SEED, 'self', NO_KNOWN, ROWS), 'missing')
  })

  it('unguarded lazy-row require → conditional, not broken (the vision-router case)', () => {
    const r = statusFor(v2of('const { ImageGallery } = require("@deepseek-ai/dsh-client-ui-attachment")'), SEED, 'self', NO_KNOWN, ROWS)
    assert.equal(r.status, 'conditional')
    assert.deepEqual(r.conditional, ['@deepseek-ai/dsh-client-ui-attachment'])
  })

  it('unguarded conditional flips back to ok once declared', () => {
    const r = statusFor(v2of('require("@deepseek-ai/dsh-client-ui-attachment")'), SEED, 'self', NO_KNOWN, ROWS, new Set(['@deepseek-ai/dsh-client-ui-attachment']))
    assert.equal(r.status, 'ok')
  })

  it('guarded conditional (try + empty catch) → ok', () => {
    const r = statusFor(v2of('try { require("@deepseek-ai/dsh-client-ui-attachment") } catch (e) {}'), SEED, 'self', NO_KNOWN, ROWS)
    assert.equal(r.status, 'ok')
  })

  it('try-missing with conditional catch → conditional (not broken)', () => {
    const r = statusFor(v2of('try { require("gone-mod") } catch (e) { require("@deepseek-ai/dsh-client-ui-attachment") }'), SEED, 'self', NO_KNOWN, ROWS)
    assert.equal(r.status, 'conditional')
    assert.deepEqual(r.conditional, ['gone-mod', '@deepseek-ai/dsh-client-ui-attachment'])
  })
})

describe('unobservable row model (rows === null)', () => {
  it('an unresolvable spec is UNKNOWN, never missing', () => {
    assert.equal(classify('@deepseek-ai/dsh-client-runtime/client', SEED, 'self', NO_KNOWN, null), 'unknown')
    assert.equal(classify('@deepseek-ai/dsh-client-ui-attachment', SEED, 'self', NO_KNOWN, null), 'unknown')
  })

  it('seed words and known packages still resolve for certain', () => {
    assert.equal(classify('react', SEED, 'self', NO_KNOWN, null), 'ok')
    assert.equal(classify('other-plugin/client', SEED, 'self', new Set(['other-plugin']), null), 'ok')
    assert.equal(classify('self/client', SEED, 'self', NO_KNOWN, null), 'ok')
  })

  it('rowIndex() reports known:false and exact:false for a null tree', () => {
    assert.deepEqual(rowIndex(null), { immediate: new Set(), lazy: new Set(), known: false, exact: false })
    assert.equal(rowIndex({ immediate: ['a'], lazy: ['b'] }).known, true)
    assert.equal(rowIndex({ immediate: ['a'], lazy: [], exact: false }).exact, false)
  })

  it('unguarded unknown → conditional with the unknown bucket filled (no crash verdict)', () => {
    const r = statusFor(v2of('require("@deepseek-ai/dsh-client-runtime/client"); require("react")'), SEED, 'self', NO_KNOWN, null)
    assert.equal(r.status, 'conditional')
    assert.deepEqual(r.unknown, ['@deepseek-ai/dsh-client-runtime/client'])
    assert.deepEqual(r.conditional, [])
    assert.equal(r.missing, undefined)
  })

  it('guarded unknown still degrades to ok (the catch covers it either way)', () => {
    const r = statusFor(v2of('try { require("@deepseek-ai/dsh-client-runtime/client") } catch (e) { require("react") }'), SEED, 'self', NO_KNOWN, null)
    assert.equal(r.status, 'ok')
  })

  it('an unguarded unknown never turns a broken verdict on', () => {
    const r = statusFor(v2of('require("@deepseek-ai/dsh-client-runtime/client")'), SEED, 'self', NO_KNOWN, null)
    assert.notEqual(r.status, 'broken')
  })
})
