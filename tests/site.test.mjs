/**
 * The web paste box (index.html + web/*) imports the CLI's pure modules from
 * ../lib/. These tests lock two things that would otherwise rot silently:
 *
 *   1. browser safety — the transitive import closure reachable from web/ must
 *      never pull in a `node:` builtin (collect.mjs and diagnose.mjs are the two
 *      Node-bound modules and must stay OUT of that closure);
 *   2. web diagnosis behavior — diagnosePastedError over the real rule base and
 *      the real renderer, including its honest degradation (rows unavailable →
 *      unclassified warnings, never a false crash).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { diagnosePastedError } from '../web/diagnose.mjs'
import { moduleTimeline } from '../web/render.mjs'
import { findingFixSteps, findingTitle, renderText } from '../lib/report.mjs'
import { t } from '../lib/i18n.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const SEEDS = JSON.parse(readFileSync(join(ROOT, 'lib/data/shell-seeds.json'), 'utf8'))
const FIXES = JSON.parse(readFileSync(join(ROOT, 'lib/data/fixes.json'), 'utf8'))

/** Follow `import … from '<path>'` to the transitive closure, resolving relative specifiers. */
function importClosure(entry) {
  const seen = new Set()
  const visit = (file) => {
    const abs = resolve(ROOT, file)
    if (seen.has(abs)) return
    seen.add(abs)
    const text = readFileSync(abs, 'utf8')
    for (const m of text.matchAll(/^\s*import[^'"]*?from\s*['"]([^'"]+)['"]/gm)) {
      const spec = m[1]
      if (spec.startsWith('.')) visit(join(dirname(file), spec))
    }
  }
  visit(entry)
  return [...seen]
}

describe('browser-safety of the web closure', () => {
  const closure = importClosure('web/app.mjs')

  it('never pulls in a node: builtin (fs/child_process/path/os)', () => {
    for (const file of closure) {
      const text = readFileSync(file, 'utf8')
      assert.doesNotMatch(text, /from\s*['"]node:/, `${file} imports a node: builtin`)
    }
  })

  it('the Node-bound modules stay out of the web closure', () => {
    const rel = closure.map((f) => f.slice(ROOT.length + 1))
    assert.equal(rel.includes('lib/collect.mjs'), false, 'collect.mjs is Node-only')
    assert.equal(rel.includes('lib/diagnose.mjs'), false, 'diagnose.mjs is Node-only')
    // the pure core is what actually drives the page
    for (const f of ['lib/errparse.mjs', 'lib/rules.mjs', 'lib/scanner.mjs', 'lib/report.mjs', 'lib/net.mjs']) {
      assert.equal(rel.includes(f), true, `${f} is part of the web closure`)
    }
  })
})

describe('diagnosePastedError (web)', () => {
  const SAMPLE = 'HARNESS Failed to load plugins: failed to import loader entry f059e6c1 (dsh-at-file): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table'

  it('a never-shipped module with rows unavailable is UNCLASSIFIED, never a crash', () => {
    // rows: null is the page's default when the roster cannot be loaded. The
    // module is not a seed word of any shell, so it must read "could not be
    // classified" — never a fabricated crash — but the history and the bundled
    // recipe still name it and the migration.
    const r = diagnosePastedError({ text: SAMPLE, lang: 'en', shellVersion: '0.1.2-rc.1', seeds: SEEDS, fixes: FIXES, toolVersion: '9.9.9' })
    assert.equal(r.kind, 'report')
    assert.match(r.text, /could not be classified on this shell/)
    assert.match(r.text, /never shipped in ANY published shell/)
    assert.match(r.text, /Migrate to @deepseek-ai\/dsh-client-store/)
    assert.equal(r.report.summary.errors, 0)
    assert.equal(r.report.summary.unclassified, 1)
  })

  it('with the published roster, the same module is a confirmed crash', () => {
    const rows = { immediate: [], lazy: ['@deepseek-ai/dsh-client-ui-attachment'] }
    const r = diagnosePastedError({ text: SAMPLE, lang: 'en', shellVersion: '0.1.2-rc.1', seeds: SEEDS, fixes: FIXES, rows, toolVersion: '9.9.9' })
    assert.equal(r.report.summary.errors, 1)
    assert.match(r.text, /missed the module table/)
  })

  it('a built-in graph-row require is conditional, not a crash (the vision-router class)', () => {
    const rows = { immediate: [], lazy: ['@deepseek-ai/dsh-client-ui-attachment'] }
    const r = diagnosePastedError({
      text: 'client-modules: require("@deepseek-ai/dsh-client-ui-attachment") missed the module table',
      lang: 'en', shellVersion: '0.1.2-rc.1', seeds: SEEDS, fixes: FIXES, rows, toolVersion: '9.9.9',
    })
    assert.equal(r.report.summary.errors, 0)
    assert.equal(r.report.summary.conditional, 1)
    assert.match(r.text, /is a built-in graph row of this shell/)
    assert.match(r.text, /declare it in dsh\.client\.external/) // the bundled fixEn recipe
  })

  it('a bare red screen is reported as needing the CLI, not guessed', () => {
    const r = diagnosePastedError({ text: 'Failed to load plugins', lang: 'en', seeds: SEEDS, toolVersion: '9.9.9' })
    assert.equal(r.kind, 'bare')
  })

  it('unknown text → honest unrecognized answer with the pattern list', () => {
    const r = diagnosePastedError({ text: 'Segfault at 0xdeadbeef', lang: 'zh', seeds: SEEDS, toolVersion: '9.9.9' })
    assert.equal(r.kind, 'unrecognized')
    assert.match(r.text, /暂不认识这个报错模式/)
    assert.match(r.text, /missed the module table/)
  })

  it('a pasted dsh-why CLI report is a result, not an error', () => {
    const r = diagnosePastedError({
      text: 'dsh-why v0.1.6 — dsh (DeepSeek Harness) failure diagnostics\nEnvironment:\n  dsh: 0.1.2-rc.1\nFindings:\n✓ All clear — 5 plugin(s) load fine',
      lang: 'en', seeds: SEEDS, toolVersion: '9.9.9',
    })
    assert.equal(r.kind, 'not-error')
  })

  it('an unreadable error never claims a local install was read (published roster, no shellPkg leak)', () => {
    const rows = { immediate: ['@a/b'], lazy: ['@c/d'] }
    const r = diagnosePastedError({ text: 'Segfault at 0xdeadbeef', lang: 'zh', shellVersion: '0.1.2-rc.1', seeds: SEEDS, rows, toolVersion: '9.9.9' })
    assert.match(r.text, /观测站发布的名册/)
    assert.doesNotMatch(r.text, /published roster/) // the shellPkg must not leak the source label
    assert.doesNotMatch(r.text, /挂载集读自本机安装/) // the CLI's local-install claim
    assert.doesNotMatch(r.text, /Tip: --json/) // no CLI tip on the web
  })

  it('empty input → empty, nothing to render', () => {
    assert.equal(diagnosePastedError({ text: '   ', lang: 'en', seeds: SEEDS }).kind, 'empty')
  })
})

describe('renderText web options', () => {
  const report = diagnosePastedError({
    text: 'client-modules: require("@deepseek-ai/dsh-client-ui-attachment") missed the module table',
    lang: 'en', shellVersion: '0.1.2-rc.1', seeds: SEEDS, fixes: FIXES,
    rows: { immediate: [], lazy: ['@deepseek-ai/dsh-client-ui-attachment'] },
    toolVersion: '9.9.9',
  }).report

  it('rowsNote replaces the install-centric rows line', () => {
    const out = renderText(report, 'en', '9.9.9', { color: false, rowsNote: 'rows: published roster (superset)', hint: false })
    assert.match(out, /rows: published roster \(superset\)/)
    assert.doesNotMatch(out, /mounted-set read from the local install/)
  })

  it('hint: false drops the CLI tip line', () => {
    const out = renderText(report, 'en', '9.9.9', { color: false, hint: false })
    assert.doesNotMatch(out, /Tip: --json/)
    assert.doesNotMatch(out, /Docs: https:\/\/dsh-why\.com/)
  })
})


describe('shared title / fix steps / timeline (web ↔ CLI, one source of truth)', () => {
  const s = t('en')

  it('findingTitle mirrors the CLI for every finding shape', () => {
    assert.equal(findingTitle({ rule: 'R1', severity: 'error', plugin: 'dsh-at-file', fromError: true, missing: ['x'], resolvableNow: false }, s), 'dsh-at-file crashes the loader on this dsh')
    assert.equal(findingTitle({ rule: 'R1', severity: 'warning', fromError: true, missing: ['x'], resolvableNow: 'unknown' }, s), 'the module in the pasted error could not be classified on this shell')
    assert.equal(findingTitle({ rule: 'R1', severity: 'warning', fromError: true, missing: ['x'], resolvableNow: 'conditional' }, s), 'the module in the pasted error is a built-in graph row of this shell')
    assert.equal(findingTitle({ rule: 'R1', severity: 'warning', plugin: 'p', reason: 'undeclared-lazy-row', conditional: ['@x/y'] }, s), 'p: resolves only conditionally on this dsh')
    assert.equal(findingTitle({ rule: 'R2', plugin: 'p' }, s), 'p: declared dsh range does not cover your dsh')
  })

  it('findingFixSteps is empty for non-actionable states', () => {
    assert.deepEqual(findingFixSteps({ rule: 'R1', resolvableNow: true }, s), [])
    assert.deepEqual(findingFixSteps({ rule: 'R1', resolvableNow: 'conditional' }, s), [])
    assert.equal(findingFixSteps({ rule: 'R1', resolvableNow: 'unknown' }, s).length, 1)
  })

  it('moduleTimeline reduces history to a displayable shape', () => {
    assert.deepEqual(moduleTimeline({ kind: 'never' }), { kind: 'never' })
    assert.deepEqual(moduleTimeline({ kind: 'shipped', since: '0.0.1-rc.5' }), { kind: 'present', since: '0.0.1-rc.5' })
    assert.deepEqual(moduleTimeline({ kind: 'shipped', since: '0.0.1-rc.5', last: '0.1.0-rc.7', removedIn: '0.1.0-rc.8' }), { kind: 'removed', since: '0.0.1-rc.5', last: '0.1.0-rc.7', removedIn: '0.1.0-rc.8' })
    assert.deepEqual(moduleTimeline(undefined), { kind: 'unknown' })
  })
})

describe('landing page structure', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')

  it('has no duplicate element ids (a collision silently rebinds getElementById)', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
    assert.deepEqual([...new Set(duplicates)], [], `duplicate id(s): ${[...new Set(duplicates)].join(', ')}`)
  })

  it('every in-page anchor has a target to land on', () => {
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    for (const anchor of anchors) assert.equal(ids.has(anchor), true, `#${anchor} has no target`)
  })

  it('advertises both jobs on the hero, not just the startup check', () => {
    // the run command and its reference group must be reachable without scrolling far
    assert.match(html, /npx dsh-why run/)
    assert.match(html, /href="#run-failures"/)
    assert.match(html, /id="ref-runs"/)
  })
})

describe('the run reference list survives a stale client script', () => {
  it('keeps a static fallback that matches RUN_PAGES exactly', async () => {
    const { RUN_PAGES } = await import('../web/gen/run-pages.mjs')
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    const block = /<ul id="ref-runs">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? ''
    const hrefs = [...block.matchAll(/href="\/e\/([^/]+)\//g)].map((m) => m[1])
    // Order-independent equality: the HTML may be reordered without breaking, but
    // a page added to RUN_PAGES without a fallback line must fail here.
    assert.deepEqual([...hrefs].sort(), RUN_PAGES.map((p) => p.slug).sort())
  })

  it('the fallback is not shadowed by the script (the script clears and refills it)', () => {
    const app = readFileSync(join(ROOT, 'web', 'app.mjs'), 'utf8')
    assert.match(app, /ul\.textContent = ''/)
    assert.match(app, /'ref-runs'/)
  })
})
