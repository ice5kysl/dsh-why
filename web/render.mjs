/**
 * dsh-why web — structured report renderer. Builds the diagnosis DOM from the
 * SAME report object the CLI's `--json` emits (no second logic), and reuses the
 * shared findingTitle / findingFixSteps / pickLocalized from lib/report.mjs so
 * the page and the terminal can never disagree about what a finding says.
 *
 * The clipboard gets the CLI-identical plain text (renderText), not a web
 * paraphrase — one verdict, one source of truth, three surfaces.
 *
 * @module dsh-why/web/render
 */

import { t } from '../lib/i18n.mjs'
import { buildIssueTemplate, findingFixSteps, findingTitle, pickLocalized, renderText } from '../lib/report.mjs'
import { webT } from './strings.mjs'

const SEV_ICON = { error: '✗', warning: '⚠', info: 'ℹ', note: '·' }

/** Mirror of report.mjs's verdictText (obs verdict → human string). */
function verdictLabel(s, observed) {
  const v = observed?.verdict
  if (!v) return null
  const vt = s.verdictText?.[v]
  if (typeof vt === 'function') return vt(observed.since, observed.okUntil)
  return vt ?? v
}

/**
 * The module history, reduced to a displayable timeline:
 *   { kind: 'never' }
 *   { kind: 'present', since }
 *   { kind: 'removed', since, last, removedIn }
 *   { kind: 'unknown' } when the history is absent.
 */
export function moduleTimeline(history) {
  if (!history) return { kind: 'unknown' }
  if (history.kind === 'never') return { kind: 'never' }
  if (history.removedIn) return { kind: 'removed', since: history.since, last: history.last, removedIn: history.removedIn }
  return { kind: 'present', since: history.since }
}

function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text != null) e.textContent = text
  return e
}

// ── sections ────────────────────────────────────────────────────────────────
function mountTimeline(container, spec, timeline, s, w) {
  const row = el('div', 'timeline')
  row.appendChild(el('code', 'spec', spec))
  const track = el('div', `track t-${timeline.kind}`, null)
  row.appendChild(track)
  let label
  if (timeline.kind === 'never') label = w.timelineNever
  else if (timeline.kind === 'present') label = `${w.timelinePresent} ${timeline.since}`
  else if (timeline.kind === 'removed') label = `${w.timelineRemoved} ${timeline.removedIn} (${w.timelinePresent} ${timeline.since} → ${timeline.last})`
  else label = null
  if (label) row.appendChild(el('span', 'tlabel', label))
  container.appendChild(row)
}

function mountKnownFix(container, knownFixes, s, lang) {
  const entries = Object.entries(knownFixes ?? {})
  if (!entries.length) return
  const w = webT(lang)
  const box = el('div', 'knownfix')
  box.appendChild(el('div', 'kf-title', w.knownFixTitle))
  for (const [spec, kf] of entries) {
    const fix = pickLocalized(lang, kf.fix, kf.fixEn)
    if (fix) box.appendChild(el('div', 'kf-fix', fix))
    for (const c of kf.cases ?? []) {
      const line = el('div', 'kf-case')
      line.appendChild(el('span', 'kf-repo', c.repo ?? ''))
      const note = pickLocalized(lang, c.note, c.noteEn)
      if (note) line.appendChild(el('span', 'kf-note', ` — ${note}`))
      if (c.url) {
        const a = el('a', 'kf-url', c.url)
        a.href = c.url; a.target = '_blank'; a.rel = 'noopener'
        line.appendChild(a)
      }
      box.appendChild(line)
    }
  }
  container.appendChild(box)
}

function mountSteps(container, steps) {
  if (!steps.length) return
  const ol = el('ol', 'steps')
  for (const step of steps) ol.appendChild(el('li', null, step))
  container.appendChild(ol)
}

function mountFindingBody(finding, s, lang) {
  const frag = document.createDocumentFragment()

  if (finding.rule === 'R1') {
    const state = finding.resolvableNow
    const missing = finding.missing ?? []
    if (state === 'unknown') frag.appendChild(el('div', 'symptom', s.r1SymptomUnverified(missing)))
    else if (state === false || state === undefined) frag.appendChild(el('div', 'symptom', s.r1Symptom(missing)))

    for (const spec of missing) {
      mountTimeline(frag, spec, moduleTimeline(finding.history?.[spec]), s, webT(lang))
    }

    if (state === true) frag.appendChild(el('div', 'note-line', s.r1NowResolved))
    else if (state === 'conditional') frag.appendChild(el('div', 'note-line', s.r1NowConditional))
    else if (state === 'unknown') frag.appendChild(el('div', 'note-line', s.r1NowUnknown))

    const vt = verdictLabel(s, finding.observed)
    if (vt) frag.appendChild(el('div', 'observed', vt))
    if (finding.observed?.stale) frag.appendChild(el('div', 'stale', s.r1ObservedStale(finding.observed.measuredVersion, finding.observed.installedVersion ?? '?')))

    const max = Object.entries(finding.ecosystemMissing ?? {}).sort((a, b) => b[1] - a[1])[0]
    if (max && max[1] > 0) {
      const w = webT(lang)
      frag.appendChild(el('div', 'ecosystem', `${max[1]} ${max[1] === 1 ? w.ecosystemOne : w.ecosystem}`))
    }

    mountSteps(frag, findingFixSteps(finding, s))
    mountKnownFix(frag, finding.knownFixes, s, lang)
  } else if (finding.rule === 'R2') {
    frag.appendChild(el('div', 'symptom', finding.undecidable ? s.r2Undecidable(finding.enginesDsh) : s.r2Detail(finding.enginesDsh, finding.dshVersion)))
    mountSteps(frag, findingFixSteps(finding, s))
  } else if (finding.rule === 'R3') {
    frag.appendChild(el('div', 'symptom', s.r3Detail(finding.installed ?? '?', finding.latest)))
  } else if (finding.rule === 'R5') {
    frag.appendChild(el('div', 'symptom', s.r5Detail))
  } else if (finding.rule === 'R6') {
    frag.appendChild(el('div', 'symptom', finding.leftover ? s.r6LeftoverDetail : s.r6MissingDetail))
    mountSteps(frag, findingFixSteps(finding, s))
  }
  return frag
}

function mountFinding(container, finding, s, lang, defaultOpen) {
  const card = el('article', `finding sev-${finding.severity}`)
  const head = el('button', 'finding-head', null)
  head.type = 'button'
  head.setAttribute('aria-expanded', String(defaultOpen))
  head.appendChild(el('span', `sev-icon ${finding.severity}`, SEV_ICON[finding.severity] ?? '·'))
  head.appendChild(el('span', 'rule-badge', finding.rule))
  head.appendChild(el('h3', 'finding-title', findingTitle(finding, s)))
  head.appendChild(el('span', 'chevron', '▾'))
  const body = el('div', 'finding-body', null)
  body.hidden = !defaultOpen
  body.appendChild(mountFindingBody(finding, s, lang))
  head.addEventListener('click', () => {
    body.hidden = !body.hidden
    head.setAttribute('aria-expanded', String(!body.hidden))
  })
  card.appendChild(head)
  card.appendChild(body)
  container.appendChild(card)
}

// ── top-level ───────────────────────────────────────────────────────────────
function mountSummary(container, report, s, w) {
  const bar = el('div', 'summary')
  const chips = el('div', 'chips')
  const sum = report.summary ?? {}
  if (sum.errors > 0) chips.appendChild(el('span', 'chip err', `${SEV_ICON.error} ${sum.errors} ${w.summaryErrors}`))
  if (sum.warnings > 0) chips.appendChild(el('span', 'chip warn', `${SEV_ICON.warning} ${sum.warnings} ${w.summaryWarnings}`))
  if (sum.notes > 0) chips.appendChild(el('span', 'chip note', `${SEV_ICON.note} ${sum.notes} ${w.summaryNotes}`))
  if (sum.conditional > 0) chips.appendChild(el('span', 'chip cond', `? ${sum.conditional} ${w.summaryConditional}`))
  if (sum.unclassified > 0) chips.appendChild(el('span', 'chip unk', `? ${sum.unclassified} ${w.summaryUnclassified}`))
  if (!chips.childNodes.length) chips.appendChild(el('span', 'chip ok', `✓ ${w.allGreen}`))
  bar.appendChild(chips)
  container.appendChild(bar)
}

function mountMeta(container, report, s, w) {
  const meta = el('div', 'meta')
  if (report.install?.shellVersion) {
    meta.appendChild(el('span', 'meta-item', `${w.envShell}: ${report.install.shellVersion}`))
  }
  if (report.seed?.version) {
    const origin = report.seed.origin === 'upstream' ? w.envUpstream : w.envBundled
    meta.appendChild(el('span', 'meta-item', `${w.envSeed}: ${report.seed.version} (${origin})`))
  }
  if (report.errorRefs) {
    const refs = []
    if (report.errorRefs.plugins?.length) refs.push(`plugin: ${report.errorRefs.plugins.join(', ')}`)
    if (report.errorRefs.modules?.length) refs.push(`module: ${report.errorRefs.modules.join(', ')}`)
    if (refs.length) meta.appendChild(el('span', 'meta-item', refs.join(' · ')))
  }
  if (meta.childNodes.length) container.appendChild(meta)
}

export function mountReport(container, report, lang, toolVersion) {
  container.textContent = ''
  const s = t(lang)
  const w = webT(lang)

  mountSummary(container, report, s, w)
  mountMeta(container, report, s, w)

  const findings = report.findings ?? []
  if (findings.length) {
    const head = el('h2', 'findings-title', w.findingsTitle)
    head.id = 'findings'
    container.appendChild(head)
    const list = el('div', 'findings')
    for (const finding of findings) mountFinding(list, finding, s, lang, finding.severity === 'error')
    container.appendChild(list)
  } else if (report.summary?.healthy) {
    container.appendChild(el('p', 'all-green-detail', w.allGreenDetail))
  }

  // copy report (CLI-identical text) — appended once, wired by the caller.
  const actions = el('div', 'report-actions')
  const copy = el('button', 'ghost', w.copy)
  copy.type = 'button'
  copy.id = 'copy-report'
  actions.appendChild(copy)

  const issue = buildIssueTemplate(report, lang, toolVersion)
  if (issue) {
    const copyIssue = el('button', 'ghost', w.copyIssue)
    copyIssue.type = 'button'
    copyIssue.id = 'copy-issue'
    actions.appendChild(copyIssue)
  }
  container.appendChild(actions)

  return {
    plainText: () => renderText(report, lang, toolVersion, { color: false, rowsNote: null, hint: false }),
    issueText: () => issue ?? null,
  }
}
