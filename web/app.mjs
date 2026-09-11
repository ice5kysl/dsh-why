/**
 * dsh-why web — page wiring. Loads the data, listens to the paste box, and
 * renders the structured diagnosis (web/render.mjs) from the same report object
 * the CLI's --json emits. Browser-only; the pasted text never leaves the page.
 *
 * @module dsh-why/web/app
 */

import { diagnosePastedError } from './diagnose.mjs'
import { mountReport } from './render.mjs'
import { webT } from './strings.mjs'
import { fetchJson, loadCompatObserved, loadFixes, loadShellSeeds, URLS } from '../lib/net.mjs'
import { compareVersions } from '../lib/scanner.mjs'

const $ = (id) => document.getElementById(id)

// ── language ────────────────────────────────────────────────────────────────
function detectLang() {
  const q = new URLSearchParams(location.search).get('lang')
  if (q === 'zh' || q === 'en') return q
  try { if (localStorage.getItem('dsh-why.lang')) return localStorage.getItem('dsh-why.lang') } catch { /* ignore */ }
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

let lang = detectLang()

function applyLang() {
  document.documentElement.dataset.lang = lang
  try { localStorage.setItem('dsh-why.lang', lang) } catch { /* ignore */ }
  $('lang-en').classList.toggle('on', lang === 'en')
  $('lang-zh').classList.toggle('on', lang === 'zh')
  document.title = lang === 'zh' ? 'dsh-why — 你的 dsh 为什么挂了？' : 'dsh-why — why did your dsh break?'
  document.querySelectorAll('[data-en]').forEach((el) => { el.textContent = lang === 'en' ? el.dataset.en : el.dataset.zh })
  document.querySelectorAll('[data-en-ph]').forEach((el) => { el.placeholder = lang === 'en' ? el.dataset.enPh : el.dataset.zhPh })
  // re-render an already-shown report in the new language
  if (LAST_REPORT) mountResult({ kind: 'report', report: LAST_REPORT })
}

// ── theme (auto → light → dark) ─────────────────────────────────────────────
const THEME_LABEL = { auto: '◐', light: '☀', dark: '☾' }
function currentTheme() {
  try { return localStorage.getItem('dsh-why.theme') || 'auto' } catch { return 'auto' }
}
function applyTheme() {
  const t = currentTheme()
  if (t === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
  $('theme').textContent = THEME_LABEL[t]
}

// ── data ────────────────────────────────────────────────────────────────────
let DATA = null
async function loadData() {
  if (DATA) return DATA
  const [bundledSeeds, bundledFixes] = await Promise.all([
    fetchJson('lib/data/shell-seeds.json'),
    fetchJson('lib/data/fixes.json'),
  ])
  const [seeds, fixes, rowsDoc, observed] = await Promise.all([
    loadShellSeeds({ offline: false, bundled: bundledSeeds }),
    loadFixes({ offline: false, bundled: bundledFixes }),
    fetchJson(URLS.shellRows).catch(() => null),
    loadCompatObserved({ offline: false }),
  ])
  DATA = { seeds: seeds.doc, seedsOrigin: seeds.origin, fixes: fixes.doc, fixesOrigin: fixes.origin, rowsDoc, observed }
  return DATA
}

function fillVersions(seeds) {
  const versions = Object.keys(seeds?.versions ?? {}).sort(compareVersions)
  const distTags = seeds?.distTags ?? {}
  const sel = $('version')
  sel.innerHTML = ''
  const none = document.createElement('option')
  none.value = ''
  none.textContent = webT(lang).versionUnknown
  sel.appendChild(none)
  for (const v of versions.slice().reverse()) {
    const o = document.createElement('option')
    o.value = v
    const tag = Object.keys(distTags).find((k) => distTags[k] === v)
    o.textContent = tag ? `${v}  (${tag})` : v
    sel.appendChild(o)
  }
  const fromUrl = new URLSearchParams(location.search).get('v')
  const wanted = fromUrl && versions.includes(fromUrl) ? fromUrl : (distTags.next ?? distTags.latest ?? versions[versions.length - 1] ?? '')
  if (wanted) sel.value = wanted
}

// ── rendering ───────────────────────────────────────────────────────────────
let LAST_REPORT = null

function mountResult(result) {
  const out = $('out')
  out.textContent = ''
  const w = webT(lang)

  const prov = document.createElement('div')
  prov.className = 'provenance'
  prov.textContent = w.provenance
  out.appendChild(prov)

  if (result.kind === 'report') {
    LAST_REPORT = result.report
    const handle = mountReport(out, result.report, lang, '0.1.7')
    out.querySelector('#copy-report')?.addEventListener('click', async () => {
      await copyText(handle.plainText())
      flashButton(out.querySelector('#copy-report'), w.copying)
    })
    out.querySelector('#copy-issue')?.addEventListener('click', async () => {
      await copyText(handle.issueText())
      flashButton(out.querySelector('#copy-issue'), w.issueCopied)
    })
  } else {
    LAST_REPORT = null
    if (result.kind === 'empty') out.appendChild(el('p', 'empty', w.empty))
    else if (result.kind === 'not-error') out.appendChild(el('p', 'warn-note', w.notError))
    else if (result.kind === 'bare') {
      out.appendChild(el('p', 'warn-note', w.bare))
      out.appendChild(el('span', 'bare-cmd', w.bareCmd))
    } else if (result.kind === 'unrecognized') {
      out.appendChild(el('p', 'warn-note', `${w.unrecognizedTitle} — ${w.unrecognized}`))
      const pre = document.createElement('pre')
      pre.className = 'report'
      pre.textContent = result.text
      out.appendChild(pre)
    }
  }
}

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable */ }
}

function flashButton(btn, label) {
  if (!btn) return
  const original = btn.textContent
  btn.textContent = label
  setTimeout(() => { btn.textContent = original }, 1200)
}

function mountSkeleton() {
  const out = $('out')
  out.textContent = ''
  const sk = el('div', 'skeleton')
  sk.appendChild(el('div', 'sk-bar w40'))
  sk.appendChild(el('div', 'sk-bar w90'))
  sk.appendChild(el('div', 'sk-bar w70'))
  sk.appendChild(el('div', 'sk-bar w85'))
  out.appendChild(sk)
}

// ── diagnosis ───────────────────────────────────────────────────────────────
async function run() {
  const text = $('input').value
  if (!text.trim()) { LAST_REPORT = null; mountResult({ kind: 'empty' }); return }
  const status = $('status')
  status.hidden = false
  status.textContent = webT(lang).loading
  mountSkeleton()
  try {
    const data = await loadData()
    const version = $('version').value || null
    const rows = version && data.rowsDoc?.versions?.[version] ? data.rowsDoc.versions[version] : null
    const result = diagnosePastedError({
      text, lang, shellVersion: version || null,
      seeds: data.seeds, seedsOrigin: data.seedsOrigin,
      rows, rowsExact: true,
      fixes: data.fixes, fixesOrigin: data.fixesOrigin,
      observed: data.observed,
      toolVersion: '0.1.7',
    })
    mountResult(result)
  } catch (error) {
    LAST_REPORT = null
    $('out').textContent = ''
    $('out').appendChild(el('div', 'warn-note', `${webT(lang).internalError}: ${error?.message ?? error}`))
  } finally {
    status.hidden = true
  }
}

// ── shareable link ──────────────────────────────────────────────────────────
function shareUrl() {
  const u = new URL(location.href)
  const text = $('input').value.trim()
  const version = $('version').value
  if (text) u.searchParams.set('e', text)
  if (version) u.searchParams.set('v', version)
  u.searchParams.set('lang', lang)
  return u.href
}

// ── boot ────────────────────────────────────────────────────────────────────
let debounce = null

function boot() {
  applyLang()
  applyTheme()
  $('lang-en').addEventListener('click', () => { lang = 'en'; applyLang() })
  $('lang-zh').addEventListener('click', () => { lang = 'zh'; applyLang() })
  $('theme').addEventListener('click', () => {
    const next = { auto: 'light', light: 'dark', dark: 'auto' }[currentTheme()]
    try { localStorage.setItem('dsh-why.theme', next) } catch { /* ignore */ }
    applyTheme()
  })

  $('run').addEventListener('click', run)
  $('paste').addEventListener('click', async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { $('input').value = t; run() } } catch { /* denied */ }
  })
  $('copy-cmd').addEventListener('click', async () => {
    await copyText('npx dsh-why')
    flashButton($('copy-cmd'), webT(lang).copying)
  })
  $('copylink').addEventListener('click', async () => {
    await copyText(shareUrl())
    flashButton($('copylink'), webT(lang).copylinkDone)
  })
  $('version').addEventListener('change', () => { if ($('input').value.trim()) run() })

  // paste → auto-diagnose (debounced), ⌘/Ctrl+Enter forces it
  $('input').addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(run, 500)
  })
  $('input').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run() }
  })

  // shareable prefill: ?e=<text>&v=<version>&lang=<lang>
  const q = new URLSearchParams(location.search)
  if (q.get('e')) {
    try { $('input').value = decodeURIComponent(q.get('e')) } catch { $('input').value = q.get('e') }
  }

  // the reference index is generated (it grows with the matrix and the rule set)
  fetch('web/ref-pages.json')
    .then((r) => r.json())
    .then(({ modules, runs }) => {
      for (const [id, entries, href, label] of [
        ['ref-modules', modules, (m) => `/m/${m.slug}/`, (m) => m.slug],
        ['ref-runs', runs, (r) => `/e/${r.slug}/`, (r) => r.slug],
      ]) {
        const ul = $(id)
        if (!ul || !entries?.length) continue
        ul.textContent = ''
        for (const entry of entries) {
          const li = document.createElement('li')
          const a = document.createElement('a')
          a.href = href(entry)
          const code = document.createElement('code')
          code.textContent = label(entry)
          a.appendChild(code)
          li.appendChild(a)
          ul.appendChild(li)
        }
      }
    })
    .catch(() => { /* the static error links remain; the generated groups fall back to the sitemap */ })

  loadData()
    .then((data) => {
      fillVersions(data.seeds)
      if ($('input').value.trim()) run()
      else mountResult({ kind: 'empty' })
    })
    .catch(() => { if ($('input').value.trim()) run() })
}

boot()
