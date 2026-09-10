/**
 * dsh-why web — page wiring. Loads the data, listens to the paste box and the
 * version selector, and renders the diagnosis produced by ./diagnose.mjs.
 *
 * Browser-only; everything the pasted text touches stays on this page. The only
 * network calls fetch public, static data from dsh-insights.com (CORS-open).
 *
 * @module dsh-why/web/app
 */

import { diagnosePastedError } from './diagnose.mjs'
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
const T = () => webT(lang)

function applyLang() {
  document.documentElement.dataset.lang = lang
  try { localStorage.setItem('dsh-why.lang', lang) } catch { /* ignore */ }
  document.title = T().title
  $('lang-en').classList.toggle('on', lang === 'en')
  $('lang-zh').classList.toggle('on', lang === 'zh')
  document.querySelectorAll('[data-en]').forEach((el) => { el.textContent = lang === 'en' ? el.dataset.en : el.dataset.zh })
  document.querySelectorAll('[data-en-ph]').forEach((el) => { el.placeholder = lang === 'en' ? el.dataset.enPh : el.dataset.zhPh })
  document.querySelectorAll('[data-en-note]').forEach((el) => { el.textContent = lang === 'en' ? el.dataset.enNote : el.dataset.zhNote })
}

// ── data (fetched once, cached across diagnoses) ────────────────────────────
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

// ── version selector ────────────────────────────────────────────────────────
function fillVersions(seeds) {
  const versions = Object.keys(seeds?.versions ?? {}).sort(compareVersions)
  const distTags = seeds?.distTags ?? {}
  const sel = $('version')
  sel.innerHTML = ''
  const opt = document.createElement('option')
  opt.value = ''
  opt.textContent = T().versionUnknown
  sel.appendChild(opt)
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

function selectedVersion() {
  return $('version').value || null
}

// ── rendering ───────────────────────────────────────────────────────────────
const SEV_ICON = { error: '✗', warning: '⚠', info: 'ℹ', note: '·' }

/** A plain, copyable rendering of the report (the CLI's ANSI off, plus our web banner). */
function renderReport(result) {
  const T = webT(lang)
  const out = $('out')
  out.textContent = ''
  const banner = document.createElement('div')
  banner.className = 'provenance'
  banner.textContent = T.provenance
  out.appendChild(banner)
  const pre = document.createElement('pre')
  pre.className = 'report'
  pre.textContent = result.text
  out.appendChild(pre)
}

function renderState(kind, detail = '') {
  const T = webT(lang)
  const out = $('out')
  out.textContent = ''
  const wrap = (cls, text) => {
    const el = document.createElement('div')
    el.className = cls
    el.textContent = text
    out.appendChild(el)
  }
  if (kind === 'empty') wrap('muted', T.empty)
  else if (kind === 'bare') {
    wrap('warn', T.bare)
    const code = document.createElement('code')
    code.textContent = T.bareCmd
    out.appendChild(code)
  } else if (kind === 'unrecognized') {
    wrap('warn', `${T.unrecognizedTitle} — ${T.unrecognized}`)
    if (detail) {
      const pre = document.createElement('pre')
      pre.className = 'report'
      pre.textContent = detail
      out.appendChild(pre)
    }
  }
}

// ── the diagnosis ───────────────────────────────────────────────────────────
async function run() {
  const text = $('input').value
  const T = webT(lang)
  if (!text.trim()) { renderState('empty'); return }
  const status = $('status')
  status.textContent = T.loading
  status.hidden = false
  try {
    const data = await loadData()
    const version = selectedVersion()
    const rows = version && data.rowsDoc?.versions?.[version] ? data.rowsDoc.versions[version] : null
    const result = diagnosePastedError({
      text,
      lang,
      shellVersion: version || null,
      seeds: data.seeds,
      seedsOrigin: data.seedsOrigin,
      rows,
      rowsExact: true, // the published roster is reconciled against __DSH_BOOT__ (a superset)
      fixes: data.fixes,
      fixesOrigin: data.fixesOrigin,
      observed: data.observed,
      toolVersion: '0.1.5',
    })
    if (result.kind === 'report') renderReport(result)
    else renderState(result.kind, result.text)
  } catch (error) {
    renderState('empty')
    const el = document.createElement('div')
    el.className = 'error'
    el.textContent = `dsh-why: internal error — ${error?.message ?? error}`
    $('out').appendChild(el)
  } finally {
    status.hidden = true
  }
}

// ── copy / paste helpers ────────────────────────────────────────────────────
async function copyReport() {
  const pre = $('out').querySelector('pre.report')
  if (!pre) return
  try {
    await navigator.clipboard.writeText(pre.textContent)
    const btn = $('copy')
    const T = webT(lang)
    btn.textContent = T.copying
    setTimeout(() => { btn.textContent = T.copy }, 1200)
  } catch { /* clipboard unavailable */ }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text) { $('input').value = text; run() }
  } catch { /* permission denied */ }
}

// ── boot ────────────────────────────────────────────────────────────────────
function boot() {
  applyLang()
  $('lang-en').addEventListener('click', () => { lang = 'en'; applyLang() })
  $('lang-zh').addEventListener('click', () => { lang = 'zh'; applyLang() })
  $('run').addEventListener('click', run)
  $('copy').addEventListener('click', copyReport)
  $('paste').addEventListener('click', pasteFromClipboard)
  $('input').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() })

  // shareable prefill: ?e=<text>&v=<version>&lang=<lang>
  const fromUrl = new URLSearchParams(location.search).get('e')
  if (fromUrl) {
    try { $('input').value = decodeURIComponent(fromUrl) } catch { $('input').value = fromUrl }
  }

  // the version list needs the data; render it as soon as it arrives, then run
  // if there is already text to diagnose.
  loadData()
    .then((data) => { fillVersions(data.seeds); if ($('input').value.trim()) run() })
    .catch(() => { if ($('input').value.trim()) run() }) // data fetch failed — the report degrades on its own
}

boot()
