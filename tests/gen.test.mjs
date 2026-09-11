/**
 * The error/module topic-page generator (web/gen/e.mjs). Locks the two things
 * that make these pages worth having for search + GEO: the exact error string is
 * the page title, and every page is bilingual with FAQ JSON-LD.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
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

describe('the reported rule-base version has one source', () => {
  it('ref-pages.json carries the package version, not a hand-kept literal', () => {
    const ref = JSON.parse(readFileSync(join(out, 'web', 'ref-pages.json'), 'utf8'))
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(ref.toolVersion, pkg.version)
  })
})

describe('internal link graph (the pages used to be 30 orphan leaves)', () => {
  const rootIndex = readFileSync(join(new URL('..', import.meta.url).pathname, 'index.html'), 'utf8')

  /** every page the generator wrote, plus its outbound topic links */
  function linkGraph() {
    const pages = new Map()
    const add = (rel) => {
      const file = join(out, rel, 'index.html')
      if (!existsSync(file)) return
      const html = readFileSync(file, 'utf8')
      // only real page links; in-page anchors (#…) are checked by another test
      const hrefs = [...html.matchAll(/href="(\/(?:e|m|guide)\/[^"#]*)"/g)].map((m) => m[1])
      pages.set(`/${rel}/`, { html, hrefs })
    }
    for (const group of ['e', 'm']) {
      for (const entry of readdirSync(join(out, group))) add(`${group}/${entry}`)
    }
    add('guide')
    return pages
  }

  it('has no dead internal links', () => {
    const pages = linkGraph()
    for (const [path, { hrefs }] of pages) {
      for (const href of hrefs) {
        assert.equal(pages.has(href), true, `${path} links ${href}, which was not generated`)
      }
    }
  })

  it('has no orphan page — every topic page links to at least one other', () => {
    for (const [path, { hrefs }] of linkGraph()) {
      assert.equal(hrefs.filter((h) => h !== path).length > 0, true, `${path} is an orphan leaf`)
    }
  })

  it('run pages link sibling failures with the exact error string as anchor text', async () => {
    const { RUN_PAGES } = await import('../web/gen/run-pages.mjs')
    const bySlug = new Map(RUN_PAGES.map((p) => [p.slug, p]))
    for (const page of RUN_PAGES) {
      const html = page_(out, `e/${page.slug}`)
      assert.equal(page.related.length >= 2, true, `${page.slug} has too few related classes`)
      for (const slug of page.related) {
        // the link exists…
        assert.match(html, new RegExp(`href="/e/${slug}/"`), `${page.slug} → ${slug}`)
        // …and its anchor text is the target's own error string, which is what the
        // reader searched for and what the target page ranks for
        assert.match(html, new RegExp(escRe(bySlug.get(slug).exact)), `${page.slug} → ${slug} anchor text`)
      }
    }
  })

  it('every topic page carries a BreadcrumbList, and its anchors exist on the home page', () => {
    const ids = new Set([...rootIndex.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    for (const [path, { html }] of linkGraph()) {
      assert.match(html, /"@type":"BreadcrumbList"/, `${path} has no BreadcrumbList`)
      for (const anchor of [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])) {
        assert.equal(ids.has(anchor), true, `${path} points at #${anchor}, which the home page does not define`)
      }
    }
  })
})

function page_(root, rel) {
  return readFileSync(join(root, rel, 'index.html'), 'utf8')
}

/** The anchor text is the target's error string AS RENDERED: esc() first, then regex. */
function escRe(s) {
  const htmlEscaped = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return htmlEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('the /guide/ page (the orientation layer)', () => {
  const html = () => readFileSync(join(out, 'guide', 'index.html'), 'utf8')

  it('answers what it is, which command when, and what it refuses to do', () => {
    const page = html()
    for (const heading of ['What dsh-why is', 'Which one do I run?', 'If you publish a plugin', 'What it will never do', 'Exit codes']) {
      assert.match(page, new RegExp(heading.replace(/[?]/g, '\\?')), `missing section: ${heading}`)
    }
    // the exit-code contract has to be on the page people land on
    assert.match(page, /could not be performed/)
  })

  it('lists the failure classes from the generators, not by hand', async () => {
    const { RUN_PAGES } = await import('../web/gen/run-pages.mjs')
    const page = html()
    for (const run of RUN_PAGES) {
      assert.match(page, new RegExp(`href="/e/${run.slug}/"`), `guide is missing ${run.slug}`)
    }
    for (const slug of ['missed-the-module-table', 'cannot-resolve', 'bundle-script-failed', 'failed-to-load-plugins']) {
      assert.match(page, new RegExp(`href="/e/${slug}/"`), `guide is missing ${slug}`)
    }
  })

  it('is bilingual and carries a BreadcrumbList', () => {
    const page = html()
    assert.match(page, /en-only/)
    assert.match(page, /zh-only/)
    assert.match(page, /"@type":"BreadcrumbList"/)
  })

  it('is reachable from every other page (no orphan hub)', () => {
    const page = html()
    assert.match(page, /href="\/"/) // the wordmark
    // and every generated page links back to it via the footer
    for (const group of ['e', 'm']) {
      for (const entry of readdirSync(join(out, group))) {
        const file = join(out, group, entry, 'index.html')
        if (!existsSync(file)) continue
        assert.match(readFileSync(file, 'utf8'), /href="\/guide\/"/, `${group}/${entry} does not link the guide`)
      }
    }
  })

  it('ships in the sitemap and llms.txt', () => {
    assert.match(readFileSync(join(out, 'sitemap.xml'), 'utf8'), /https:\/\/dsh-why\.com\/guide\//)
    assert.match(readFileSync(join(out, 'llms.txt'), 'utf8'), /https:\/\/dsh-why\.com\/guide\//)
  })
})

describe('the deploy artifact includes everything the generator writes', () => {
  it('pages.yml copies every top-level directory the generator emits', () => {
    // The page set is generated; the deploy list is hand-written. They drifted
    // once already: /guide/ shipped in the sitemap while never being copied into
    // _site, so the site advertised a 404.
    const workflow = readFileSync(join(new URL('..', import.meta.url).pathname, '.github', 'workflows', 'pages.yml'), 'utf8')
    const copyLine = /cp -r ([^\n]+?) _site\//.exec(workflow)
    assert.ok(copyLine, 'pages.yml has no cp -r … _site/ line')
    const copied = new Set(copyLine[1].split(/\s+/).filter(Boolean))
    const { generate: gen } = { generate }
    const written = gen(mkdtempSync(join(tmpdir(), `dsh-why-artifact-${Date.now()}-`)))
    const topLevel = new Set(written.map((p) => p.replace(/^\//, '').split('/')[0]))
    for (const dir of topLevel) {
      assert.equal(copied.has(dir), true, `pages.yml does not copy ${dir}/ — it will 404 in production`)
    }
    for (const file of ['index.html', 'llms.txt', 'sitemap.xml']) {
      assert.equal(copied.has(file), true, `pages.yml does not copy ${file}`)
    }
  })
})
