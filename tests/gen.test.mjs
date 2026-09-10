/**
 * The error/module topic-page generator (web/gen/e.mjs). Locks the two things
 * that make these pages worth having for search + GEO: the exact error string is
 * the page title, and every page is bilingual with FAQ JSON-LD.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { generate } from '../web/gen/e.mjs'

const out = mkdtempSync(join(tmpdir(), 'dsh-why-gen-'))
generate(out)

function page(rel) {
  return readFileSync(join(out, rel, 'index.html'), 'utf8')
}

describe('topic-page generator', () => {
  it('emits an error page whose title IS the exact error string', () => {
    const html = page('e/missed-the-module-table')
    assert.match(html, /<title>“missed the module table”/)
    assert.match(html, /client-modules: require\(&quot;…&quot;\) missed the module table/)
    assert.match(html, /https:\/\/dsh-why\.com\/e\/missed-the-module-table\//)
  })

  it('carries FAQ JSON-LD (GEO: LLMs can lift the Q&A verbatim)', () => {
    const html = page('e/missed-the-module-table')
    assert.match(html, /"@type":"FAQPage"/)
    assert.match(html, /Failed to load plugins/)
  })

  it('is bilingual — every prose block has a zh twin (both in the DOM)', () => {
    const html = page('e/missed-the-module-table')
    assert.match(html, /en-only/)
    assert.match(html, /zh-only/)
    assert.match(html, /根因/) // the zh heading
    assert.match(html, /怎么修/)
    assert.doesNotMatch(html, /data-zh=/) // CSS dual-language, not attribute swapping
  })

  it('emits a module page with the never-shipped timeline for the retired runtime', () => {
    const html = page('m/dsh-client-runtime')
    assert.match(html, /@deepseek-ai\/dsh-client-runtime/)
    assert.match(html, /track t-never/)
    assert.match(html, /dsh-client-store/) // the migration recipe
  })

  it('emits the removed-in timeline for a seed word that left in 0.1.0-rc.8', () => {
    const html = page('m/dsh-client-ui-attachment')
    assert.match(html, /track t-present/)
    assert.match(html, /0\.0\.1-rc\.5/) // its first shell
  })

  it('writes exactly the known set (4 errors + 4 modules)', () => {
    for (const p of ['missed-the-module-table', 'cannot-resolve', 'bundle-script-failed', 'failed-to-load-plugins']) {
      assert.equal(existsSync(join(out, 'e', p, 'index.html')), true, `e/${p}`)
    }
    for (const p of ['dsh-client-runtime', 'dsh-client-ui-attachment', 'dsh-client-web-react', 'dsh-client-schema-form']) {
      assert.equal(existsSync(join(out, 'm', p, 'index.html')), true, `m/${p}`)
    }
  })
})


describe('long-tail module pages (compat-observed)', () => {
  // two plugins missing 'stream', plus junk the filter must drop
  const observed = {
    plugins: {
      a: { results: { x: { status: 'broken', missing: ['stream', './types.js', '@deepseek-ai/dsh-client-ui-renderer/client'] } } },
      b: { results: { x: { status: 'broken', missing: ['stream', 'node:fs'] } } },
      c: { results: { x: { status: 'broken', missing: ['@mixmark-io/domino'] } } },
    },
  }
  const out = mkdtempSync(join(tmpdir(), 'dsh-why-gen-tail-'))
  generate(out, { compatObserved: observed })

  it('emits a page for a real never-shipped package with its ecosystem count', () => {
    const html = readFileSync(join(out, 'm/stream/index.html'), 'utf8')
    assert.match(html, /<h1><code>stream<\/code><\/h1>/)
    assert.match(html, /track t-never/)
    assert.match(html, /2 plugin\(s\) ecosystem-wide/)
  })

  it('drops plugin-internal files (.js) and platform packages from the long tail', () => {
    assert.equal(existsSync(join(out, 'm/types.js')), false)
    assert.equal(existsSync(join(out, 'm/dsh-client-ui-renderer')), false)
    assert.equal(existsSync(join(out, 'm/fs')), false) // node:fs → node: prefix excluded
  })

  it('scoped npm packages get a readable slug', () => {
    const html = readFileSync(join(out, 'm/domino/index.html'), 'utf8')
    assert.match(html, /@mixmark-io\/domino/)
    assert.match(html, /1 plugin\(s\) ecosystem-wide/)
  })

  it('module pages carry FAQ JSON-LD too (GEO: Q&A a crawler can lift)', () => {
    const html = readFileSync(join(out, 'm/stream/index.html'), 'utf8')
    assert.match(html, /"@type":"FAQPage"/)
    assert.match(html, /Why does require\(\\"stream\\"\) break a dsh plugin\?/)
    assert.match(html, /How do I fix a plugin that requires it\?/)
  })

  it('every long-tail page carries a ?e= deep link into the paste box', () => {
    const html = readFileSync(join(out, 'm/stream/index.html'), 'utf8')
    assert.match(html, /\?e=client-modules%3A%20require\(%22stream%22\)/)
  })
})
