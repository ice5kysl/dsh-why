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

  it('the lang toggle persists the choice (localStorage) and honors ?lang= first', () => {
    const html = page('e/missed-the-module-table')
    assert.match(html, /localStorage\.getItem\('dsh-why\.lang'\)/)
    assert.match(html, /localStorage\.setItem\('dsh-why\.lang'/)
    assert.match(html, /get\('lang'\)/)
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

describe('run-failure topic pages (dsh-why run)', () => {
  it('emits one page per attributable failure class, exact string as the title', async () => {
    const { FAILURE_CLASSES } = await import('../lib/runrules.mjs')
    const { RUN_PAGES } = await import('../web/gen/run-pages.mjs')
    const slugs = Object.values(FAILURE_CLASSES).map((c) => c.slug).filter(Boolean).sort()
    assert.deepEqual(RUN_PAGES.map((p) => p.slug).sort(), slugs)
    for (const slug of slugs) {
      const html = page(`e/${slug}`)
      assert.match(html, new RegExp(`https://dsh-why\\.com/e/${slug}/`), `${slug} canonical`)
      assert.match(html, /"@type":"FAQPage"/, `${slug} FAQ JSON-LD`)
      assert.match(html, /en-only/)
      assert.match(html, /zh-only/)
    }
  })

  it('every topic URL the CLI prints resolves to a generated page (no 404 from a report)', async () => {
    const { FAILURE_CLASSES } = await import('../lib/runrules.mjs')
    for (const [name, meta] of Object.entries(FAILURE_CLASSES)) {
      if (!meta.slug) continue // provider-unknown deliberately has no page
      const url = `/e/${meta.slug}/`
      assert.equal(existsSync(join(out, url.replace(/^\//, ''), 'index.html')), true, `${name} → ${url}`)
    }
    // and the one class with no page says so, rather than pointing somewhere wrong
    assert.equal(FAILURE_CLASSES['provider-unknown'].slug, null)
  })

  it('tells the reader the fix steps and answers the plugin question explicitly', () => {
    const html = page('e/provider-transport')
    assert.match(html, /Re-run the turn/)
    assert.match(html, /class="runfix"/)
    assert.match(html, /Is this my plugin.s fault\?/)
    assert.match(html, /不是。/) // the zh answer is in the DOM too
  })

  it('lists all eight run pages in the sitemap and llms.txt', () => {
    const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8')
    const llms = readFileSync(join(out, 'llms.txt'), 'utf8')
    assert.match(llms, /## Run failure reference/)
    assert.match(llms, /npx dsh-why run --all/)
    for (const slug of ['provider-transport', 'provider-auth-401', 'provider-missing-credential',
      'provider-quota', 'provider-pricing', 'model-unavailable', 'provider-server', 'provider-timeout']) {
      assert.match(sitemap, new RegExp(`https://dsh-why\\.com/e/${slug}/`), `${slug} in sitemap`)
      assert.match(llms, new RegExp(`https://dsh-why\\.com/e/${slug}/`), `${slug} in llms.txt`)
    }
  })

  it('publishes the run list for the landing page reference index', () => {
    const ref = JSON.parse(readFileSync(join(out, 'web', 'ref-pages.json'), 'utf8'))
    assert.equal(ref.runs.length, 8)
    assert.equal(ref.runs[0].slug, 'provider-transport')
    assert.match(ref.runs[0].exact, /api\.deepseek\.com/)
  })

  it('refuses to emit a page set that has drifted from the classifier', async () => {
    const { assertRunPagesMatchClassifier } = await import('../web/gen/e.mjs')
    const classes = { a: { slug: 'one' }, b: { slug: 'two' } }
    // the real pair passes
    assert.deepEqual(assertRunPagesMatchClassifier(classes, [{ slug: 'one' }, { slug: 'two' }]), { pages: 2 })
    // a class with no page is a 404 the report already printed
    assert.throws(() => assertRunPagesMatchClassifier(classes, [{ slug: 'one' }]), /no page: two/)
    // a page no class can produce is dead weight
    assert.throws(() => assertRunPagesMatchClassifier(classes, [{ slug: 'one' }, { slug: 'two' }, { slug: 'three' }]), /no class: three/)
    // a slugless class (provider-unknown) must not demand a page
    assert.deepEqual(assertRunPagesMatchClassifier({ a: { slug: 'one' }, x: { slug: null } }, [{ slug: 'one' }]), { pages: 1 })
  })
})

describe('inventory does not shrink when live data is unavailable', () => {
  it('carries previously generated long-tail pages into the sitemap', async () => {
    const { generate } = await import('../web/gen/e.mjs')
    const { mkdtempSync, writeFileSync, mkdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'dsh-why-carry-'))

    // a page that only a live build would have produced
    mkdirSync(join(dir, 'm', 'some-long-tail'), { recursive: true })
    writeFileSync(join(dir, 'm', 'some-long-tail', 'index.html'), '<html></html>')

    generate(dir) // no compatObserved: the offline path

    const sitemap = readFileSync(join(dir, 'sitemap.xml'), 'utf8')
    assert.match(sitemap, /https:\/\/dsh-why\.com\/m\/some-long-tail\//)
    const ref = JSON.parse(readFileSync(join(dir, 'web', 'ref-pages.json'), 'utf8'))
    assert.equal(ref.modules.some((m) => m.slug === 'some-long-tail'), true)
  })
})
