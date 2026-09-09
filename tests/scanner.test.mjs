/**
 * Scanner tests: the guard-aware require extractor ported from
 * dsh-insights compat-observed, plus statusFor verdict semantics.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compareVersions, extractRequiresV2, statusFor, stripClientSuffix } from '../lib/scanner.mjs'

const SEED = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store'])
const NO_KNOWN = new Set()

function guards(bundle) {
  return extractRequiresV2(bundle).requiresV2
}

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
    // comment-decoy sits in a comment: the extractor regex does see it
    // (upstream-consistent quirk) but it must NOT gain a guard context
    assert.equal(bySpec['comment-decoy'].guard, 'unguarded')
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
  const v2of = (bundle) => extractRequiresV2(bundle).requiresV2

  it('unguarded missing → broken', () => {
    const r = statusFor(v2of('require("react"); require("gone-mod")'), SEED, 'self', NO_KNOWN)
    assert.equal(r.status, 'broken')
    assert.deepEqual(r.missing, ['gone-mod'])
  })

  it('seed words and own package name resolve', () => {
    const r = statusFor(v2of('require("react"); require("self/client")'), SEED, 'self', NO_KNOWN)
    assert.equal(r.status, 'ok')
  })

  it('known plugin packages resolve via the /client strip (registered factory)', () => {
    const r = statusFor(v2of('require("other-plugin/client")'), SEED, 'self', new Set(['other-plugin']))
    assert.equal(r.status, 'ok')
  })

  it('try-miss with resolvable catch → ok (fallback path works)', () => {
    const r = statusFor(v2of('try { require("gone-mod") } catch (e) { require("react") }'), SEED, 'self', NO_KNOWN)
    assert.equal(r.status, 'ok')
  })

  it('try-miss with empty catch → ok (graceful degradation)', () => {
    const r = statusFor(v2of('try { require("gone-mod") } catch (e) {}'), SEED, 'self', NO_KNOWN)
    assert.equal(r.status, 'ok')
  })

  it('try-miss with catch-miss → broken, both sides listed', () => {
    const r = statusFor(v2of('try { require("gone-a") } catch (e) { require("gone-b") }'), SEED, 'self', NO_KNOWN)
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
