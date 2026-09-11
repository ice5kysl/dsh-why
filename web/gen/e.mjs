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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { FAILURE_CLASSES } from '../../lib/runrules.mjs'
import { RUN_PAGES } from './run-pages.mjs'

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
    sample: 'client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table',
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
    sample: 'client-modules: cannot resolve "@deepseek-ai/dsh-client-ui-attachment"',
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
    sample: 'client-modules: bundle script /plugins/dsh-at-file/client.js failed to load',
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
    sample: 'HARNESS Failed to load plugins: failed to import loader entry (dsh-at-file): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table',
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
  return `<script>(function(){function saved(){try{return localStorage.getItem('dsh-why.lang')}catch(e){return null}}function l(){return new URLSearchParams(location.search).get('lang')||saved()||((navigator.language||'').toLowerCase().startsWith('zh')?'zh':'en')}function a(){var x=l();document.documentElement.dataset.lang=x;document.querySelectorAll('.langsel button').forEach(function(n){n.classList.toggle('on',n.dataset.l===x)})}a();document.querySelectorAll('.langsel button').forEach(function(n){n.addEventListener('click',function(){try{localStorage.setItem('dsh-why.lang',n.dataset.l)}catch(e){}var u=new URL(location.href);u.searchParams.set('lang',n.dataset.l);location=u})})})();</script>`
}

function shell({ title, description, path, jsonLd, body }) {
  return `<!doctype html>
<html lang="en" data-lang="en">
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
<script type="module" src="/web/analytics.mjs"></script>
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<header class="nav">
  <a class="wordmark" href="/"><span class="mark">❯</span>dsh-why</a>
  <div class="nav-right">
    <div class="seg langsel"><button data-l="en">EN</button><button data-l="zh">中文</button></div>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer>
  <div class="inner">
    <p class="fnote">${t('dsh-why — the “why did my dsh break” diagnostic.', 'dsh-why——「我的 dsh 为什么挂了」诊断。')}</p>
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

function moduleFaqJsonLd(name, fixText) {
  return faqJsonLd([
    { q: { en: `Why does require("${name}") break a dsh plugin?` }, a: { en: `dsh resolves require() only against the module table baked into each shell build, plus registered plugin factories — "${name}" is not in that table, so a plugin's client bundle cannot resolve it in the browser.` } },
    { q: { en: 'How do I fix a plugin that requires it?' }, a: { en: fixText } },
  ])
}

// the generic recipe for a package dsh never ships (long-tail modules)
const GENERIC_FIX_EN = 'Bundle the dependency into the plugin (keeping react and @deepseek-ai/cordis external to avoid duplicates), or wrap the require in try/catch and degrade gracefully. The loader resolves require() at call time, so a paired catch turns the crash into a fallback.'
const GENERIC_FIX_ZH = '把该依赖打进插件自身 bundle（react 和 @deepseek-ai/cordis 保持 external 避免双份），或给 require 加 try/catch 兜底降级。加载器是调用时解析 require 的，配对的 catch 能把崩溃变成优雅降级。'

// Both languages live in the DOM; CSS ([data-lang]) shows one. This keeps the
// bilingual copy visible to crawlers/LLMs and never swaps HTML into textContent.
const t = (en, zh) => `<span class="en-only">${en}</span><span class="zh-only">${zh}</span>`
const b = (enHtml, zhHtml) => `<div class="en-only">${enHtml}</div><div class="zh-only">${zhHtml}</div>`
function sec(titleEn, titleZh, enHtml, zhHtml) {
  return `<section class="e-sec"><h2>${t(esc(titleEn), esc(titleZh))}</h2>${b(enHtml, zhHtml)}</section>`
}
function secShared(titleEn, titleZh, bodyHtml) {
  return `<section class="e-sec"><h2>${t(esc(titleEn), esc(titleZh))}</h2>${bodyHtml}</section>`
}

const deepLink = (sample) => `/?e=${encodeURIComponent(sample)}`
const ctaFor = (sample) => `<div class="cta"><code>npx dsh-why</code> <a href="${deepLink(sample)}">${t('diagnose this exact error in the browser', '在浏览器里直接诊断这条报错')}</a></div>`

// ── generators ──────────────────────────────────────────────────────────────
function errorPage(p) {
  const cta = ctaFor(p.sample)
  const body = `
  <header class="hero slim">
    <p class="kicker">DeepSeek Harness · failure diagnosis</p>
    <h1>${esc(p.title)}</h1>
    <p class="errstring"><code>${esc(p.exact)}</code></p>
    ${b(`<p class="lead">${esc(p.lead.en)}</p>`, `<p class="lead">${esc(p.lead.zh)}</p>`)}
  </header>
  ${sec('Why it happens', '根因', `<p>${esc(p.cause.en)}</p>`, `<p>${esc(p.cause.zh)}</p>`)}
  ${sec('How to fix it', '怎么修', `<p>${esc(p.fix.en)}</p>${cta}`, `<p>${esc(p.fix.zh)}</p>${cta}`)}
  ${sec('FAQ', '常见问题', p.faq.map((f) => `<div class="qa"><p class="q">${esc(f.q.en)}</p><p class="a">${esc(f.a.en)}</p></div>`).join(''), p.faq.map((f) => `<div class="qa"><p class="q">${esc(f.q.zh)}</p><p class="a">${esc(f.a.zh)}</p></div>`).join(''))}
  `
  return shell({
    title: p.title, description: p.description, path: `e/${p.slug}/`, jsonLd: faqJsonLd(p.faq), body,
  })
}

/**
 * A run-failure page. Unlike the startup pages there is no paste-box deep link:
 * the web tool diagnoses loader errors, and a run failure is read from the local
 * session log by `dsh-why run`. The CTA points at that command instead of
 * pretending a URL can do the work.
 */
function runPage(p) {
  const cta = `<div class="cta"><code>npx dsh-why run</code> <a href="${ORIGIN}/#run-failures">${t('see every run failure this can name', '看它能定性的全部运行期失败')}</a></div>`
  const steps = (items) => `<ol class="runfix">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>`
  const qa = (lang) => p.faq
    .map((f) => `<div class="qa"><p class="q">${esc(f.q[lang])}</p><p class="a">${esc(f.a[lang])}</p></div>`)
    .join('')
  const body = `
  <header class="hero slim">
    <p class="kicker">DeepSeek Harness · run failure</p>
    <h1>${esc(p.title)}</h1>
    <p class="errstring"><code>${esc(p.exact)}</code></p>
    ${b(`<p class="lead">${esc(p.lead.en)}</p>`, `<p class="lead">${esc(p.lead.zh)}</p>`)}
  </header>
  ${sec('Why it happens', '根因', `<p>${esc(p.cause.en)}</p>`, `<p>${esc(p.cause.zh)}</p>`)}
  ${sec('How to fix it', '怎么修', `${steps(p.fix.en)}${cta}`, `${steps(p.fix.zh)}${cta}`)}
  ${sec('Is this my plugin’s fault?', '这是我的插件引起的吗？', `<p>${esc(p.plugin.en)}</p>`, `<p>${esc(p.plugin.zh)}</p>`)}
  ${sec('FAQ', '常见问题', qa('en'), qa('zh'))}
  `
  return shell({
    title: p.title, description: p.description, path: `e/${p.slug}/`, jsonLd: faqJsonLd(p.faq), body,
  })
}

/**
 * The run pages and the CLI must agree on slugs in BOTH directions: a page the
 * classifier cannot produce is dead weight, and a class with no page is a 404
 * that the report already printed. Fail the build rather than ship either.
 *
 * @param {object} [classes] FAILURE_CLASSES-shaped map (injectable for tests)
 * @param {object[]} [pages] RUN_PAGES-shaped list (injectable for tests)
 */
export function assertRunPagesMatchClassifier(classes = FAILURE_CLASSES, pages = RUN_PAGES) {
  const classifier = Object.values(classes).map((c) => c.slug).filter(Boolean).sort()
  const slugs = pages.map((p) => p.slug).sort()
  const missing = classifier.filter((slug) => !slugs.includes(slug))
  const extra = slugs.filter((slug) => !classifier.includes(slug))
  if (missing.length || extra.length) {
    throw new Error(`run topic pages drift from the classifier — no page: ${missing.join(', ') || 'none'}; no class: ${extra.join(', ') || 'none'}`)
  }
  return { pages: slugs.length }
}

function modulePage(entry, baseName, seeds) {
  const h = moduleHistoryFor(baseName, seeds)
  const status = entry.status ?? ''
  const fix = entry.fix ?? ''
  const fixEn = entry.fixEn ?? fix
  const cases = entry.cases ?? []
  const track = h.kind === 'never' ? 't-never' : 't-present'
  const label = h.kind === 'never'
    ? t('never shipped in any shell module table', '从未进入任何 shell 模块表')
    : t(`present since ${h.since}`, `自 ${h.since} 起`)
  const timelineHtml = `<div class="timeline"><code class="spec">${esc(baseName)}</code><div class="track ${track}"></div><span class="tlabel">${label}</span></div>`

  const caseHtml = cases.map((c) => `<div class="kf-case"><span class="kf-repo">${esc(c.repo)}</span>${c.note ? `<span class="kf-note">${t(` — ${esc(c.noteEn ?? c.note)}`, ` —— ${esc(c.note)}`)}</span>` : ''}${c.url ? `<a class="kf-url" href="${esc(c.url)}" rel="noopener" target="_blank">${esc(c.url)}</a>` : ''}</div>`).join('')

  const cta = ctaFor(`client-modules: require("${baseName}") missed the module table`)
  const body = `
  <header class="hero slim">
    <p class="kicker">DeepSeek Harness · module reference</p>
    <h1><code>${esc(baseName)}</code></h1>
    ${b('<p class="lead">Lifecycle of this module across published shells, and the known fix when a plugin requires it.</p>', '<p class="lead">该模块在各已发布 shell 上的生命周期，以及插件 require 它时的已知修法。</p>')}
  </header>
  ${secShared('Module history', '模块历史', timelineHtml)}
  ${secShared('Status', '状态', `<p class="mstatus">${esc(status)}</p>`)}
  <section class="e-sec"><h2>${t('Known fix', '已知修法')}</h2><div class="knownfix">${b(`<div class="kf-fix">${esc(fixEn)}</div>`, `<div class="kf-fix">${esc(fix)}</div>`)}${caseHtml}</div></section>
  ${cta}
  `
  return shell({
    title: `${baseName} — dsh module history & fix`, description: `Lifecycle of ${baseName} across dsh shells and the known fix when a plugin requires it.`, path: `m/${baseName}/`, jsonLd: moduleFaqJsonLd(baseName, fixEn), body,
  })
}

/**
 * Ecosystem-wide "most-hit" missing modules from the observed-compat matrix:
 * non-relative require specifiers that broke plugins, minus seed words and the
 * modules the case base already covers. One page each = the scalable "one page
 * per error" long tail.
 */
function isLongTailCandidate(spec) {
  if (spec[0] === '.' || spec[0] === '/') return false // relative/absolute (plugin-internal files)
  if (spec.endsWith('.js')) return false               // a file reference, not a package
  if (spec.startsWith('node:')) return false            // node: builtin — the fs/stream pages already tell that story
  if (spec.startsWith('@deepseek-ai/')) return false    // platform packages: their story is the graph-row model, not this long tail
  return true
}

function topMissingModules(observed, seeds, fixes, limit = 24) {
  const counts = new Map()
  const everSeed = new Set()
  for (const ws of Object.values(seeds.versions ?? {})) for (const w of ws) everSeed.add(w)
  const known = new Set(Object.keys(fixes.modules ?? {}).map((spec) => (spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec)))
  for (const entry of Object.values(observed.plugins ?? {})) {
    const seen = new Set()
    for (const result of Object.values(entry.results ?? {})) {
      for (const spec of result?.missing ?? []) {
        if (!isLongTailCandidate(spec)) continue
        const base = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
        if (everSeed.has(base) || known.has(base) || seen.has(base)) continue
        seen.add(base)
        counts.set(base, (counts.get(base) ?? 0) + 1)
      }
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

/** A module the case base does not cover: generic "bundle it or guard it" recipe. */
function genericModulePage(name, count, seeds) {
  const h = moduleHistoryFor(name, seeds)
  const track = h.kind === 'never' ? 't-never' : 't-present'
  const label = h.kind === 'never'
    ? t('never shipped in any shell module table', '从未进入任何 shell 模块表')
    : t(`present since ${h.since}`, `自 ${h.since} 起`)
  const timeline = `<div class="timeline"><code class="spec">${esc(name)}</code><div class="track ${track}"></div><span class="tlabel">${label}</span></div>`
  const eco = `<div class="ecosystem">${t(`${count} plugin(s) ecosystem-wide hit the same module`, `全生态 ${count} 个插件踩了同一个模块`)}</div>`
  const cta = ctaFor(`client-modules: require("${name}") missed the module table`)
  const body = `
  <header class="hero slim">
    <p class="kicker">DeepSeek Harness · module reference</p>
    <h1><code>${esc(name)}</code></h1>
    ${b('<p class="lead">A package plugins require but dsh never ships in its module table — the browser half cannot resolve it.</p>', '<p class="lead">插件会 require、但 dsh 从未放进模块表的包——浏览器端无法解析它。</p>')}
  </header>
  ${secShared('Module history', '模块历史', timeline)}
  ${secShared('Ecosystem', '生态', eco)}
  ${sec('Why it breaks', '为什么崩', '<p>dsh resolves require() only against the module table baked into each shell build plus registered plugin factories — never against node_modules. Node builtins (stream / buffer / fs / util / events …) and most npm packages are therefore never resolvable from a plugin’s client bundle.</p>', '<p>dsh 的 require() 只对照烘焙进每个 shell 构建的模块表加已注册的插件工厂解析——从不查 node_modules。所以 Node 内置模块（stream / buffer / fs / util / events …）和大多数 npm 包在插件的 client bundle 里永远解析不了。</p>')}
  ${sec('How to fix it', '怎么修', `<p>${GENERIC_FIX_EN}</p>${cta}`, `<p>${GENERIC_FIX_ZH}</p>${cta}`)}
  ${sec('FAQ', '常见问题', `<div class="qa"><p class="q">Why does require("${esc(name)}") crash in dsh but not in Node?</p><p class="a">dsh’s client bundles run in the browser and resolve against the shell module table, not node_modules. Node-only packages can never load there unless the plugin bundles them.</p></div>`, `<div class="qa"><p class="q">为什么 require("${esc(name)}") 在 dsh 里崩、在 Node 里不崩？</p><p class="a">dsh 的 client bundle 跑在浏览器里，对照 shell 模块表解析、不查 node_modules。纯 Node 包只有被打进插件自身才能在那里加载。</p></div>`)}
  `
  return shell({
    title: `${name} — not in any dsh module table (${count} plugins hit it)`,
    description: `${count} plugins ecosystem-wide require ${name}, which dsh never ships in its module table. What it means and how to fix it.`,
    path: `m/${name}/`, jsonLd: moduleFaqJsonLd(name, GENERIC_FIX_EN), body,
  })
}

// ── main ────────────────────────────────────────────────────────────────────
export function generate(outRoot = ROOT, { compatObserved = null } = {}) {
  const seeds = JSON.parse(read('lib/data/shell-seeds.json'))
  const fixes = JSON.parse(read('lib/data/fixes.json'))
  const written = []
  const moduleIndex = [] // { slug, name } — the landing page's reference list
  assertRunPagesMatchClassifier()

  for (const p of ERROR_PAGES) {
    const dir = join(outRoot, 'e', p.slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), errorPage(p))
    written.push(`e/${p.slug}/`)
  }

  for (const p of RUN_PAGES) {
    const dir = join(outRoot, 'e', p.slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), runPage(p))
    written.push(`e/${p.slug}/`)
  }

  for (const [spec, entry] of Object.entries(fixes.modules ?? {})) {
    const baseName = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
    const slug = baseName.split('/').pop() // drop the @scope for a readable URL
    const dir = join(outRoot, 'm', slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), modulePage(entry, baseName, seeds))
    written.push(`m/${slug}/`)
    moduleIndex.push({ slug, name: baseName, note: entry.status ?? null })
  }

  // the scalable long tail: one page per ecosystem "most-hit" missing module
  if (compatObserved) {
    for (const [name, count] of topMissingModules(compatObserved, seeds, fixes)) {
      const slug = name.split('/').pop()
      const dir = join(outRoot, 'm', slug)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.html'), genericModulePage(name, count, seeds))
      written.push(`m/${slug}/`)
      moduleIndex.push({ slug, name, note: 'not in any shell module table' })
    }
  } else {
    // Long-tail pages come from live ecosystem data. When that fetch fails — an
    // offline build, a CI hiccup — the pages already on disk are still linked and
    // still served, so their URLs must stay in the inventory. Dropping them would
    // silently ship a smaller sitemap for content that exists.
    const emitted = new Set(written)
    let carried = 0
    for (const slug of readdirSync(join(outRoot, 'm'))) {
      const rel = `m/${slug}/`
      if (emitted.has(rel)) continue
      if (!existsSync(join(outRoot, rel, 'index.html'))) continue
      written.push(rel)
      moduleIndex.push({ slug, name: slug, note: 'carried over from a previous live build' })
      carried++
    }
    if (carried) console.log(`dsh-why/gen: no live data — carried over ${carried} existing long-tail page(s) into the inventory`)
  }

  emitInventory(outRoot, written, moduleIndex)

  console.log(`dsh-why/gen: wrote ${written.length} pages`)
  for (const w of written) console.log('  /' + w)
  return written
}

/** The generator owns the page inventory: sitemap + llms.txt + the reference list. */
function emitInventory(outRoot, written, moduleIndex) {
  const paths = [...written].sort()

  // sitemap
  const urlset = paths.map((p) => `  <url><loc>${ORIGIN}/${p}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`).join('\n')
  writeFileSync(join(outRoot, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${ORIGIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n${urlset}\n</urlset>\n`)

  // llms.txt (the AI-facing directory, bilingual note)
  const errLines = ERROR_PAGES.map((p) => `- ${ORIGIN}/e/${p.slug}/ — \`${p.exact}\``).join('\n')
  const runLines = RUN_PAGES.map((p) => `- ${ORIGIN}/e/${p.slug}/ — \`${p.exact}\``).join('\n')
  const modLines = moduleIndex.map((m) => `- ${ORIGIN}/m/${m.slug}/ — ${m.name}${m.note ? ` (${m.note})` : ''}`).join('\n')
  writeFileSync(join(outRoot, 'llms.txt'), `# dsh-why

Diagnose DeepSeek Harness (dsh) plugin load failures. \`npx dsh-why\` reads your install; the page at ${ORIGIN} diagnoses a pasted red-screen error without any install.

## Data (stable URLs)
- https://dsh-insights.com/data/shell-seeds.json — per-shell client module tables
- https://dsh-insights.com/data/shell-rows.json — per-shell client graph rows
- https://dsh-insights.com/data/fixes.json — known-fix case base
- https://dsh-insights.com/data/compat-observed.json — observed-compat matrix

## Pages
- ${ORIGIN}/ — paste an error, get the diagnosis
- https://github.com/ice5kysl/dsh-why — source
- https://www.npmjs.com/package/dsh-why — the CLI package

## Error reference (the exact string is the title)
${errLines}

## Run failure reference (a run that booted fine and then died)
${runLines}

## Module reference (per-shell lifecycle)
${modLines}

## The CLI
- \`npx dsh-why\` — diagnose the current environment
- \`npx dsh-why --json\` — machine-readable (CI / an LLM)
- \`npx dsh-why --offline\` — bundled rule base only
- \`npx dsh-why --error "…"\` — diagnose a pasted error (or pipe via stdin)
- \`npx dsh-why run\` — attribute your latest run from the local session log
- \`npx dsh-why run --all\` — health view: failure mix, baseline, and incident days
- \`npx dsh-why run --json\` — machine-readable run report
`)

  // the landing page's reference list (module group renders from this), plus the
  // rule-base version so the browser report cannot disagree with the package
  mkdirSync(join(outRoot, 'web'), { recursive: true })
  const toolVersion = JSON.parse(read('package.json')).version
  writeFileSync(join(outRoot, 'web', 'ref-pages.json'), JSON.stringify({
    toolVersion,
    modules: moduleIndex,
    runs: RUN_PAGES.map((p) => ({ slug: p.slug, exact: p.exact })),
  }))
}

// direct execution only (not when imported by the test)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--live')) {
    const url = 'https://dsh-insights.com/data/compat-observed.json'
    fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((observed) => {
      generate(ROOT, { compatObserved: observed?.plugins ? observed : null })
    })
  } else {
    generate(ROOT)
  }
}
