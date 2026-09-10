#!/usr/bin/env node
/**
 * dsh-why · error-topic page generator (zero-dependency, run in CI + locally).
 *
 * Emits static, bilingual (en/zh) pages that are the search + GEO landing for
 * dsh loader failures:
 *   e/<slug>/index.html  — one page per recognized error pattern (the exact
 *                          error string is the H1 and the <title>, so a pasted
 *                          console line matches verbatim)
 *   m/<slug>/index.html  — one page per module in the known-fix case base, with
 *                          its per-shell history (since / removed / never)
 *
 * Data: lib/data/shell-seeds.json (module history) + lib/data/fixes.json
 * (recipes + cases). Both ship in the repo, so the build never needs network.
 *
 * The pages reuse web/base.css (the same design system as the landing page) and
 * a small self-contained lang toggle; the canonical URL is https://dsh-why.com.
 *
 * Run: node web/gen/e.mjs
 * @module dsh-why/web/gen/e
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ORIGIN = 'https://dsh-why.com'

const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8') } catch { return null } }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── editorial error pages ───────────────────────────────────────────────────
const ERROR_PAGES = [
  {
    slug: 'missed-the-module-table',
    exact: 'client-modules: require("…") missed the module table',
    title: '“missed the module table” — the dsh plugin load failure, explained',
    description: 'What “missed the module table” means in DeepSeek Harness, which plugin/module is missing, and how to fix it — run npx dsh-why for a full diagnosis.',
    lead: {
      en: 'A plugin’s client bundle called require() on a module the shell does not provide. dsh does not let plugin bundles require() arbitrary npm packages — it resolves against a module table baked into each shell build.',
      zh: '某插件的 client bundle require() 了一个 shell 不提供的模块。dsh 不允许插件任意 require() npm 包——它只对照烘焙进每个 shell 构建的模块表解析。',
    },
    cause: {
      en: 'Almost always one of: (1) the plugin was built against a module the current shell removed or never shipped (the classic case is @deepseek-ai/dsh-client-runtime, retired in favor of @deepseek-ai/dsh-client-store); or (2) a build-time external that drifted. The require is unguarded, so the loader throws and the whole client plugin tree fails.',
      zh: '几乎总是其一：(1) 插件依赖了一个当前 shell 已移除、或从未提供的模块（最典型是 @deepseek-ai/dsh-client-runtime，已被 @deepseek-ai/dsh-client-store 取代）；(2) 构建期的 external 漂移。这个 require 没有守卫，加载器一抛，整个客户端插件树跟着挂。',
    },
    fix: {
      en: 'Run npx dsh-why (read-only, zero-install) to name the plugin, the missing module, and whether the fix is to upgrade the plugin, upgrade/downgrade dsh, or remove the plugin. The known-fix case base also carries a per-module migration recipe.',
      zh: '跑 npx dsh-why（只读、零安装）定位是哪个插件、缺哪个模块，修法是升插件、升/降 dsh 还是移除插件。已知修法案例库还带每个模块的迁移处方。',
    },
    faq: [
      { q: { en: 'What does “missed the module table” mean?', zh: '「missed the module table」是什么意思？' }, a: { en: 'A require() named a specifier that is not a seed word of the shell, not a materialized module, and not a registered plugin factory.', zh: '某个 require() 的 specifier 既不是 shell 的 seed 词，也不是已物化模块，也不是已注册的插件工厂。' } },
      { q: { en: 'How do I fix dsh “Failed to load plugins”?', zh: 'dsh「Failed to load plugins」怎么修？' }, a: { en: 'Run npx dsh-why — it reads your install and tells you exactly which plugin to remove or upgrade.', zh: '跑 npx dsh-why——它读取你的安装，告诉你具体移除或升级哪个插件。' } },
    ],
  },
  {
    slug: 'cannot-resolve',
    exact: 'client-modules: cannot resolve "…"',
    title: '“cannot resolve” — the async twin of the dsh module-table miss',
    description: 'The async import() twin of “missed the module table” in DeepSeek Harness — what it means and how to fix it.',
    lead: {
      en: 'The async import() twin of “missed the module table”: the specifier is not a seed word, not materialized, and not a row in the boot graph.',
      zh: '这是「missed the module table」的异步 import() 版本：specifier 不是 seed 词、未物化、也不在 boot graph 里。',
    },
    cause: { en: 'Same root causes as the synchronous miss — a module the shell does not provide, reached through an async import().', zh: '与同步缺失同一根因——shell 不提供的模块，通过异步 import() 触达。' },
    fix: { en: 'Same fix as “missed the module table”: npx dsh-why names the module and its history.', zh: '与「missed the module table」同一修法：npx dsh-why 定位模块与它的版本历史。' },
    faq: [
      { q: { en: 'Is “cannot resolve” the same as “missed the module table”?', zh: '「cannot resolve」和「missed the module table」一样吗？' }, a: { en: 'Yes — it is the async import() variant of the same resolution failure.', zh: '一样——是同一个解析失败的异步 import() 变体。' } },
    ],
  },
  {
    slug: 'bundle-script-failed',
    exact: 'client-modules: bundle script … failed to load',
    title: '“bundle script failed to load” — a build-level dsh failure',
    description: 'The dsh client bundle itself failed to execute or parse — a build-level problem, not a module-table miss.',
    lead: { en: 'The plugin’s client bundle failed to execute or parse in the loader — a build-level problem rather than a module-table miss.', zh: '插件的 client bundle 在加载器里执行/解析失败——这是构建层面的问题，不是模块表缺失。' },
    cause: { en: 'A malformed bundle, a script that threw during evaluation, or a bundle that did not register its factory.', zh: 'bundle 畸形、求值期抛出异常、或未注册其 factory。' },
    fix: { en: 'Run npx dsh-why to confirm the plugin’s requires are satisfiable and whether a newer release exists; the author usually needs to rebuild.', zh: '跑 npx dsh-why 确认该插件的 require 是否可满足、是否有新版；通常作者需要重新构建。' },
    faq: [{ q: { en: 'Is this a missing module?', zh: '这是缺模块吗？' }, a: { en: 'Usually not — it is a build/parse failure of the bundle itself.', zh: '通常不是——是 bundle 本身的构建/解析失败。' } }],
  },
  {
    slug: 'failed-to-load-plugins',
    exact: 'Failed to load plugins',
    title: '“Failed to load plugins” — the dsh red screen, decoded',
    description: 'The dsh web red screen. It means one enabled plugin’s client bundle threw while the loader materialized it — usually a missing module.',
    lead: { en: 'The red screen when dsh web boots. One enabled plugin’s client bundle threw while the loader was materializing it — almost always a missing module.', zh: 'dsh web 启动时的红屏。某个启用插件的 client bundle 在加载器物化时抛错——几乎总是缺模块。' },
    cause: { en: 'One plugin among your enabled set is incompatible with your dsh build. The generic banner names nothing, so you need the module or plugin reference to go further.', zh: '你启用的插件里有一个与当前 dsh 构建不兼容。红屏没点名，所以要继续得拿到模块或插件引用。' },
    fix: { en: 'Run npx dsh-why for the full diagnosis; or paste the console line that follows the banner into the web tool to get the module name.', zh: '跑 npx dsh-why 做完整诊断；或把红屏后面那行控制台报错粘进网页工具拿到模块名。' },
    faq: [{ q: { en: 'dsh updated and now it won’t start — why?', zh: '升级 dsh 后打不开了，为什么？' }, a: { en: 'A plugin was written against a module the new shell removed (a 0.1.0-rc.8-style change). dsh-why names the exact version.', zh: '有插件依赖了新版 shell 移除的模块（0.1.0-rc.8 那类变更）。dsh-why 会给出确切版本。' } }],
  },
]

// ── module history from the bundled seed snapshot ──────────────────────────
function moduleHistoryFor(baseName, seeds) {
  const versions = Object.keys(seeds.versions ?? {}).sort()
  const present = versions.filter((v) => (seeds.versions[v] ?? []).includes(baseName))
  if (!present.length) return { kind: 'never' }
  return { kind: 'present', since: present[0], last: present[present.length - 1] }
}

// ── page shell ──────────────────────────────────────────────────────────────
function langToggleScript() {
  return `<script>(function(){function l(){return new URLSearchParams(location.search).get('lang')||((navigator.language||'').toLowerCase().startsWith('zh')?'zh':'en')}function a(){var x=l();document.documentElement.dataset.lang=x;document.querySelectorAll('[data-en]').forEach(function(e){e.textContent=x==='en'?e.dataset.en:e.dataset.zh});var b=document.querySelectorAll('.langsel button');b.forEach(function(n){n.classList.toggle('on',n.dataset.l===x)})}a();document.querySelectorAll('.langsel button').forEach(function(n){n.addEventListener('click',function(){var u=new URL(location.href);u.searchParams.set('lang',n.dataset.l);location=u})})})();</script>`
}

function shell({ title, description, path, jsonLd, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${ORIGIN}/${path}">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/geist/index.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/geist-mono/index.css">
<link rel="stylesheet" href="/web/base.css">
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<header class="nav">
  <a class="wordmark" href="/"><span class="caret">❯</span> dsh-why</a>
  <div class="nav-right">
    <div class="seg langsel"><button data-l="en">EN</button><button data-l="zh">中文</button></div>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer>
  <div class="inner">
    <p class="fnote" data-en="dsh-why — the “why did my dsh break” diagnostic." data-zh="dsh-why——「我的 dsh 为什么挂了」诊断。">dsh-why — the “why did my dsh break” diagnostic.</p>
    <nav><a href="/">dsh-why</a><a href="https://github.com/ice5kysl/dsh-why">GitHub</a><a href="https://dsh-insights.com/">dsh-insights.com</a></nav>
  </div>
</footer>
${langToggleScript()}
</body>
</html>
`
}

function faqJsonLd(faq) {
  const main = faq.map((f) => ({ '@type': 'Question', name: f.q.en, acceptedAnswer: { '@type': 'Answer', text: f.a.en } }))
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: main })
}

function section(title, bodyHtml) {
  return `<section class="e-sec"><h2>${title}</h2>${bodyHtml}</section>`
}

function bi(titleEn, titleZh, enHtml, zhHtml) {
  return `<section class="e-sec"><h2 data-en="${esc(titleEn)}" data-zh="${esc(titleZh)}">${esc(titleEn)}</h2><div data-en="${esc(enHtml)}" data-zh="${esc(zhHtml)}">${enHtml}</div></section>`
}

// ── generators ──────────────────────────────────────────────────────────────
function errorPage(p) {
  const cta = `<div class="cta"><code>npx dsh-why</code> <a href="/" data-en="or paste it in the browser" data-zh="或粘进浏览器">or paste it in the browser</a></div>`
  const body = `
  <header class="hero slim">
    <p class="kicker">DeepSeek Harness · failure diagnosis</p>
    <h1 data-en="${esc(p.title)}" data-zh="${esc(p.title)}">${esc(p.title)}</h1>
    <p class="errstring"><code>${esc(p.exact)}</code></p>
    <p class="lead" data-en="${esc(p.lead.en)}" data-zh="${esc(p.lead.zh)}">${esc(p.lead.en)}</p>
  </header>
  ${bi('Why it happens', '根因', `<p>${esc(p.cause.en)}</p>`, `<p>${esc(p.cause.zh)}</p>`)}
  ${bi('How to fix it', '怎么修', `<p>${esc(p.fix.en)}</p>${cta}`, `<p>${esc(p.fix.zh)}</p>${cta}`)}
  ${bi('FAQ', '常见问题', p.faq.map((f) => `<div class="qa"><p class="q" data-en="${esc(f.q.en)}" data-zh="${esc(f.q.zh)}">${esc(f.q.en)}</p><p class="a" data-en="${esc(f.a.en)}" data-zh="${esc(f.a.zh)}">${esc(f.a.en)}</p></div>`).join(''), p.faq.map((f) => `<div class="qa"><p class="q">${esc(f.q.zh)}</p><p class="a">${esc(f.a.zh)}</p></div>`).join(''))}
  `
  return shell({
    title: p.title, description: p.description, path: `e/${p.slug}/`, jsonLd: faqJsonLd(p.faq), body,
  })
}

function modulePage(entry, baseName, seeds) {
  const h = moduleHistoryFor(baseName, seeds)
  const status = entry.status ?? ''
  const fix = entry.fix ?? ''
  const fixEn = entry.fixEn ?? fix
  const cases = entry.cases ?? []
  let timelineHtml = ''
  if (h.kind === 'never') timelineHtml = `<div class="timeline"><code class="spec">${esc(baseName)}</code><div class="track t-never"></div><span class="tlabel" data-en="never shipped in any shell module table" data-zh="从未进入任何 shell 模块表">never shipped in any shell module table</span></div>`
  else timelineHtml = `<div class="timeline"><code class="spec">${esc(baseName)}</code><div class="track t-present"></div><span class="tlabel" data-en="present since ${esc(h.since)}" data-zh="自 ${esc(h.since)} 起">present since ${esc(h.since)}</span></div>`

  const caseHtml = cases.map((c) => `<div class="kf-case"><span class="kf-repo">${esc(c.repo)}</span>${c.note ? `<span class="kf-note" data-en=" — ${esc(c.noteEn ?? c.note)}" data-zh=" —— ${esc(c.note)}"> — ${esc(c.note)}</span>` : ''}${c.url ? `<a class="kf-url" href="${esc(c.url)}" rel="noopener" target="_blank">${esc(c.url)}</a>` : ''}</div>`).join('')

  const body = `
  <header class="hero slim">
    <p class="kicker">DeepSeek Harness · module reference</p>
    <h1><code>${esc(baseName)}</code></h1>
    <p class="lead" data-en="Lifecycle of this module across published shells, and the known fix when a plugin requires it." data-zh="该模块在各已发布 shell 上的生命周期，以及插件 require 它时的已知修法。">Lifecycle of this module across published shells.</p>
  </header>
  ${section('Module history', timelineHtml)}
  ${section('Status', `<p class="mstatus">${esc(status)}</p>`)}
  <section class="e-sec"><h2 data-en="Known fix" data-zh="已知修法">Known fix</h2><div class="knownfix"><div class="kf-fix" data-en="${esc(fixEn)}" data-zh="${esc(fix)}">${esc(fixEn)}</div>${caseHtml}</div></section>
  <div class="cta"><code>npx dsh-why</code> <a href="/" data-en="or paste it in the browser" data-zh="或粘进浏览器">or paste it in the browser</a></div>
  `
  return shell({
    title: `${baseName} — dsh module history & fix`, description: `Lifecycle of ${baseName} across dsh shells and the known fix when a plugin requires it.`, path: `m/${baseName}/`, jsonLd: '{}', body,
  })
}

// ── main ────────────────────────────────────────────────────────────────────
export function generate(outRoot = ROOT) {
  const seeds = JSON.parse(read('lib/data/shell-seeds.json'))
  const fixes = JSON.parse(read('lib/data/fixes.json'))
  const written = []

  for (const p of ERROR_PAGES) {
    const dir = join(outRoot, 'e', p.slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), errorPage(p))
    written.push(`e/${p.slug}/`)
  }

  for (const [spec, entry] of Object.entries(fixes.modules ?? {})) {
    const baseName = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
    const slug = baseName.split('/').pop() // drop the @scope for a readable URL
    const dir = join(outRoot, 'm', slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), modulePage(entry, baseName, seeds))
    written.push(`m/${slug}/`)
  }

  console.log(`dsh-why/gen: wrote ${written.length} pages`)
  for (const w of written) console.log('  /' + w)
  return written
}

// direct execution only (not when imported by the test)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) generate()
