/**
 * dsh-why — attribute a finished (or aborted) dsh run.
 *
 * Startup failures (`dsh-why`) are about *resolution*: does every client
 * `require()` find a module the shell provides? Run failures are about
 * *causation*: the run is over and the user has a symptom but no verdict.
 *
 * The verdict comes from `turn/end.reason`, whose shape is a closed vocabulary:
 *
 *   {"kind":"completed"}                     ~92% of turns
 *   {"kind":"aborted","reason":{"kind":"user"}} a deliberate stop — NOT a failure
 *   {"kind":"interrupted"}                   unknown: killed, window closed, or crash
 *   {"kind":"error","error":{code,message}}  attributable, and `code` is the axis
 *
 * `code` is what makes this tractable: across a real corpus every error carried
 * one of eight codes, so the whole observed failure space is enumerable rather
 * than open-ended. Codes seen in the wild, with the message sentinel that
 * disambiguates the two overloaded ones:
 *
 *   TRANSPORT (67×) · SERVER (5×) · AUTH (3×) · MISSING_CREDENTIAL (3×)
 *   QUOTA (2×) · INVALID_REQUEST (2×) · TIMEOUT (2×)
 *
 * Honesty rules, inherited from the startup path:
 *   - a deliberate abort is never a red card;
 *   - an interrupted or truncated run is reported as UNCLASSIFIED, never guessed;
 *   - an unrecognised code is `probable`, not `attributed`.
 *
 * @module dsh-why/runrules
 */

import { analyzeTurns, findSessionLogs, readSessionLog } from './sessionlog.mjs'

/**
 * The closed failure vocabulary. `topic` is the /e/ page slug a human can read.
 * `severity` is the finding severity: everything here is a failed turn.
 */
export const FAILURE_CLASSES = {
  'provider-auth': { rule: 'F1', slug: 'provider-auth-401', severity: 'error' },
  'provider-missing-credential': { rule: 'F1b', slug: 'provider-missing-credential', severity: 'error' },
  'provider-quota': { rule: 'F2', slug: 'provider-quota', severity: 'error' },
  'provider-pricing': { rule: 'F2b', slug: 'provider-pricing', severity: 'error' },
  'model-unavailable': { rule: 'F4', slug: 'model-unavailable', severity: 'error' },
  'provider-server': { rule: 'F5', slug: 'provider-server', severity: 'error' },
  'provider-transport': { rule: 'F5a', slug: 'provider-transport', severity: 'error' },
  'provider-timeout': { rule: 'F7', slug: 'provider-timeout', severity: 'error' },
  'provider-unknown': { rule: 'F8', slug: null, severity: 'error' },
}

/**
 * Message sentinels, checked BEFORE the code: `SERVER` and `INVALID_REQUEST`
 * each cover more than one real cause, and the message is what separates them.
 */
const MESSAGE_RULES = [
  [/no API key for provider route/i, 'provider-missing-credential'],
  [/pricing not configured/i, 'provider-pricing'],
  [/unsupported model/i, 'model-unavailable'],
  [/insufficient balance/i, 'provider-quota'],
  [/stream idle timeout/i, 'provider-timeout'],
  [/invalid or may have expired/i, 'provider-auth'],
  [/api request to .* failed/i, 'provider-transport'],
]

const CODE_RULES = {
  TRANSPORT: 'provider-transport',
  SERVER: 'provider-server',
  AUTH: 'provider-auth',
  MISSING_CREDENTIAL: 'provider-missing-credential',
  QUOTA: 'provider-quota',
  INVALID_REQUEST: 'model-unavailable',
  TIMEOUT: 'provider-timeout',
}

/** Which configured provider/model the failing route names, when the message says so. */
export function providerRoute(message) {
  const m = /\b(llm-[a-z0-9-]+)|(?:provider route "([^"]+)")|(?:https?:\/\/[^\s"]+)/i.exec(String(message ?? ''))
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

/**
 * The verdict for one turn. Total by construction: every input lands on a tier,
 * and only real errors reach `error`.
 */
export function classifyTurn(turn) {
  if (!turn.ended) {
    return { verdict: 'no-verdict', rule: 'F9', class: 'orphan-turn', confidence: 'unclassified', severity: 'unclassified' }
  }
  const reason = turn.ended.reason
  const kind = reason?.kind

  if (kind === 'completed') return { verdict: 'completed', class: 'ok', confidence: 'attributed', severity: 'ok' }
  if (kind === 'aborted') {
    return { verdict: 'aborted', rule: 'F0', class: 'user-abort', confidence: 'attributed', severity: 'info', stoppedBy: reason?.reason?.kind ?? null }
  }
  if (kind === 'interrupted') {
    return { verdict: 'interrupted', rule: 'F9', class: 'interrupted', confidence: 'unclassified', severity: 'unclassified' }
  }
  if (kind === 'error') {
    const code = reason?.error?.code ?? null
    const message = String(reason?.error?.message ?? '')
    for (const [pattern, name] of MESSAGE_RULES) {
      if (pattern.test(message)) return { verdict: 'error', code, message, confidence: 'attributed', ...FAILURE_CLASSES[name], class: name }
    }
    if (code && CODE_RULES[code]) {
      const name = CODE_RULES[code]
      return { verdict: 'error', code, message, confidence: 'attributed', ...FAILURE_CLASSES[name], class: name }
    }
    return { verdict: 'error', code, message, confidence: 'probable', ...FAILURE_CLASSES['provider-unknown'], class: 'provider-unknown' }
  }
  return { verdict: 'unknown', rule: 'F9', class: 'unknown-kind', confidence: 'unclassified', severity: 'unclassified' }
}

/**
 * What did the failed turn actually leave behind? The question every user asks
 * second — "did it write anything before it died?" — answered from the pairing
 * of tool calls and tool results, never from optimism.
 */
export function sideEffects(turn, verdict) {
  if (verdict.severity !== 'error' && verdict.severity !== 'unclassified') return null
  if (turn.toolCalls > 0 && turn.toolResults === 0) {
    return { rule: 'F3', class: 'no-side-effect', severity: 'warn', planned: turn.toolCalls, executed: 0 }
  }
  if (turn.toolResults > 0 && turn.toolResults < turn.toolCalls) {
    return { rule: 'F6', class: 'partial-side-effect', severity: 'warn', planned: turn.toolCalls, executed: turn.toolResults }
  }
  return null
}

const dayOf = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '(open)')

/**
 * Detect days that differ from the user's own baseline, so a one-off incident
 * (a model switch that broke the key) is not buried in chronic noise.
 *
 * Two independent reasons, both reported with their evidence:
 *   - failure-rate: a day whose error rate is far above the median day
 *   - new-signature: a failure class seen for the first time that day
 */
export function detectIncidents(byDay) {
  const days = Object.keys(byDay).sort()
  const rates = Object.entries(byDay)
    .filter(([day, d]) => day !== '(open)' && d.turns >= 4)
    .map(([, d]) => d.errors / d.turns)
    .sort((a, b) => a - b)
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : 0

  const seenBefore = new Map() // class -> first day
  for (const day of days) {
    for (const name of Object.keys(byDay[day].byClass)) {
      if (!seenBefore.has(name)) seenBefore.set(name, day)
    }
  }

  // The window's own first day cannot establish novelty: with no earlier day to
  // compare against, every class on it is trivially "new". A class counts as a
  // new signature only when earlier days exist AND none of them had it.
  const windowStart = days.find((day) => day !== '(open)') ?? null

  const incidents = []
  for (const [day, d] of Object.entries(byDay).sort()) {
    if (day === '(open)' || !d.errors) continue
    const rate = d.turns ? d.errors / d.turns : 0
    const reasons = []
    if (d.turns >= 8 && rate >= 0.25 && rate >= Math.max(median * 3, 0.1)) {
      reasons.push({ kind: 'failure-rate', rate, turns: d.turns, errors: d.errors, baseline: median })
    }
    const novel = Object.keys(d.byClass).filter((name) => seenBefore.get(name) === day && day !== windowStart)
    if (novel.length && d.errors >= 2) reasons.push({ kind: 'new-signature', classes: novel })
    if (reasons.length) incidents.push({ day, errors: d.errors, turns: d.turns, reasons })
  }
  return { incidents, baseline: median }
}

/**
 * Build the run report.
 *
 * Scope `latest` reads only the newest session log — "why did my last run stop".
 * Scope `all` walks every log (newest `limit` first) — "how healthy has my dsh
 * been", which is the only view that can tell chronic noise from an incident.
 *
 * Both scopes feed the SAME object to `--json` and to the text renderer.
 */
export function buildRunReport({ dshHome = null, scope = 'latest', limit = 200, now = Date.now() } = {}) {
  const startedAt = Date.now()
  const logs = findSessionLogs(dshHome)
  const selected = scope === 'latest' ? logs.slice(0, 1) : logs.slice(0, limit)

  const runs = []
  const byDay = {}
  const byClass = {}
  const scan = {
    logs: logs.length, logsRead: 0, bytes: 0, linesParsed: 0, chunkLines: 0,
    frames: 0, framesRead: 0, frameErrors: 0,
    truncated: 0, midFlight: 0, openTurns: 0, superseded: 0, sessions: new Set(),
  }
  let turnsSeen = 0
  let completed = 0
  let aborted = 0
  let latest = null

  for (const entry of selected) {
    let log
    try { log = readSessionLog(entry.file) } catch { continue }
    scan.logsRead++
    scan.bytes += log.bytes
    scan.linesParsed += log.linesParsed
    scan.chunkLines += log.chunkLines
    scan.frames += log.frames
    scan.framesRead += log.framesRead
    scan.frameErrors += log.frameErrors
    if (!log.complete) scan.truncated++
    if (log.endedMidFlight) scan.midFlight++
    scan.openTurns += log.openTurns
    scan.superseded += entry.superseded ?? 0
    const sessionId = log.header?.id ?? entry.sessionDir.split('/').pop()
    const workspace = log.header?.cwd ?? null
    scan.sessions.add(sessionId)

    const turns = analyzeTurns(log.events)
    for (const turn of turns) {
      turnsSeen++
      const verdict = classifyTurn(turn)
      const effects = sideEffects(turn, verdict)
      const at = turn.ended?.at ?? null
      const day = dayOf(at)

      // Every turn counts toward the day's denominator; only errors toward its numerator.
      if (!byDay[day]) byDay[day] = { turns: 0, errors: 0, byClass: {} }
      byDay[day].turns++

      if (verdict.verdict === 'completed') { completed++; continue }
      if (verdict.verdict === 'aborted') aborted++

      if (verdict.severity === 'error') {
        byDay[day].errors++
        byClass[verdict.class] = (byClass[verdict.class] ?? 0) + 1
        byDay[day].byClass[verdict.class] = (byDay[day].byClass[verdict.class] ?? 0) + 1
      }

      const run = {
        session: sessionId,
        workspace,
        turn: turn.turn,
        at,
        endedAt: at ? new Date(at).toISOString() : null,
        toolCalls: turn.toolCalls,
        toolResults: turn.toolResults,
        steps: turn.steps,
        model: turn.model,
        log: {
          format: log.format,
          frames: log.frames,
          framesRead: log.framesRead,
          framesFull: log.frames === log.framesRead,
          complete: log.complete,
          endedMidFlight: log.endedMidFlight,
          lastEvent: log.lastEvent,
          mismatches: log.mismatches,
        },
        verdict: verdict.verdict,
        class: verdict.class,
        rule: verdict.rule ?? null,
        severity: verdict.severity,
        confidence: verdict.confidence,
        code: verdict.code ?? null,
        message: verdict.message ?? null,
        stoppedBy: verdict.stoppedBy ?? null,
        topic: verdict.slug ? `/e/${verdict.slug}/` : null,
        sideEffects: effects,
      }
      runs.push(run)
      if (!latest || (at ?? 0) >= (latest.at ?? 0)) latest = run
    }
  }
  scan.sessions = scan.sessions.size

  // Only real failures count toward the mix and the exit code.
  const failures = runs.filter((r) => r.severity === 'error')
  const unclassified = runs.filter((r) => r.confidence === 'unclassified')
  const warnings = runs.filter((r) => r.sideEffects).length
  const { incidents, baseline } = detectIncidents(byDay)

  const findings = runs.map((run, index) => ({
    rule: run.rule,
    severity: run.severity,
    class: run.class,
    confidence: run.confidence,
    index,
    session: run.session,
    turn: run.turn,
    at: run.endedAt,
    code: run.code,
    message: run.message,
    topic: run.topic,
    sideEffects: run.sideEffects,
  }))

  return {
    generatedAt: new Date(now).toISOString(),
    mode: 'run',
    scope,
    dshHome,
    scan: { ...scan, turns: turnsSeen, completed, aborted, ms: Date.now() - startedAt },
    latest,
    runs,
    findings,
    mix: { failures: failures.length, byClass, byDay, baseline },
    incidents,
    summary: {
      errors: failures.length,
      warnings,
      notes: 0,
      attributed: runs.filter((r) => r.confidence === 'attributed').length,
      probable: runs.filter((r) => r.confidence === 'probable').length,
      unclassified: unclassified.length,
      healthy: failures.length === 0,
    },
  }
}
