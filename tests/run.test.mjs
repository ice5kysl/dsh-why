/**
 * `dsh-why run` — run forensics regressions.
 *
 * The fixtures are synthetic so the suite never depends on the developer's own
 * ~/.dsh. Every test below encodes something that was MEASURED on a real
 * 140-log corpus, including the traps that made a first implementation lie:
 *
 *   - a session log is a CHAIN of independent zstd frames; reading it with one
 *     `zstdDecompressSync` returns the first frame and silently drops the rest;
 *   - frames overlap, so events must be deduped by `seq`;
 *   - `seq` is sparse, so seq density must NEVER be used as a completeness test;
 *   - 61% of lines are unsequenced stream chunks, i.e. noise;
 *   - a session migrated between log formats leaves two files behind.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { analyzeTurns, findSessionLogs, readSessionLog } from '../lib/sessionlog.mjs'
import { buildRunReport, classifyTurn, detectIncidents, sideEffects } from '../lib/runrules.mjs'
import { renderRunText } from '../lib/report.mjs'

const roots = []
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-why-run-'))
  roots.push(dir)
  return dir
}
after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })

/** One zstd frame holding the given events — the real append shape. */
function frame(events) {
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  return zlib.zstdCompressSync(Buffer.from(body))
}

/** Write a session log made of independent frames, exactly as dsh appends them. */
function writeLog(home, sessionId, frames, { name = 'session.jsonl.zstd', workspace = '-tmp-ws-' } = {}) {
  const dir = join(home, 'sessions', workspace, sessionId)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, Buffer.concat(frames))
  return file
}

const HEADER = { type: 'session', version: 3, id: 'session-fixture', createdAt: 1_700_000_000_000 }

let seq = 0
const reset = () => { seq = 0 }
/** A sequenced event; pass `sparse` to jump seq like the real log does. */
function ev(type, data = {}, { sparse = 0, time = null } = {}) {
  seq += 1 + sparse
  return time === null ? { type, seq, data } : { type, seq, time, data }
}
const chunk = (type = 'assistant/chunk') => ({ type, data: { fragment: 'noise' } })

/** A minimal turn: start, a step, optional tool activity, then end with `reason`. */
function turn(n, reason, { toolCalls = 0, toolResults = 0, time = 1_700_000_000_000 } = {}) {
  const events = [
    ev('turn/start', { turn: n }, { time }),
    ev('step/start', { turn: n, step: 0 }),
  ]
  for (let i = 0; i < toolCalls; i++) events.push(ev('tool/call', { turn: n, step: 0, i }))
  for (let i = 0; i < toolResults; i++) events.push(ev('tool/result', { turn: n, step: 0, i }))
  events.push(ev('step/end', { turn: n, step: 0 }))
  if (reason !== null) events.push(ev('turn/end', { turn: n, reason }, { time: time + 1000 }))
  return events
}

const completed = { kind: 'completed' }
const abortedByUser = { kind: 'aborted', reason: { kind: 'user' } }
const interrupted = { kind: 'interrupted' }
const errorOf = (code, message) => ({ kind: 'error', error: { code, message } })

describe('session log reading — the frame chain', () => {
  it('a single zstdDecompress of the whole file returns ONLY the first frame', () => {
    const home = tempHome()
    reset()
    const events = [HEADER, ...turn(1, completed), ...turn(2, completed)]
    const file = writeLog(home, 'sess-a', events.map((e) => frame([e])))

    // This is the trap the reader exists to avoid: no error, just a wrong answer.
    const naive = zlib.zstdDecompressSync(readFileSync(file)).toString('utf8').trim().split('\n')
    assert.equal(naive.length, 1)
    assert.equal(JSON.parse(naive[0]).type, 'session')
  })

  it('walks every frame, so nothing is silently dropped', () => {
    const home = tempHome()
    reset()
    const events = [HEADER, ...turn(1, completed)]
    const file = writeLog(home, 'sess-a', events.map((e) => frame([e])))

    const log = readSessionLog(file)
    assert.equal(log.frames, events.length)
    assert.equal(log.framesRead, events.length)
    assert.equal(log.frameErrors, 0)
    assert.equal(log.events.length, events.length - 1) // header is unsequenced
    assert.deepEqual(log.header, HEADER)
    assert.equal(log.format, 'legacy')
  })

  it('reads a vN-named log and reports its format', () => {
    const home = tempHome()
    reset()
    const file = writeLog(home, 'sess-a', [frame([HEADER]), frame(turn(1, completed))], { name: 'session.v3.jsonl.zstd' })
    assert.equal(readSessionLog(file).format, 'v3')
  })

  it('dedupes overlapping frames by seq instead of double-counting', () => {
    const home = tempHome()
    reset()
    const first = turn(1, completed)
    // The second frame re-emits the first turn's tail, as a real append does.
    const file = writeLog(home, 'sess-a', [frame([HEADER, ...first]), frame([...first.slice(-3), ...turn(2, completed)])])

    const log = readSessionLog(file)
    const starts = log.events.filter((e) => e.type === 'turn/start')
    assert.equal(starts.length, 2)
    assert.equal(log.linesParsed > log.events.length, true) // overlap was observed…
    assert.equal(new Set(log.events.map((e) => e.seq)).size, log.events.length) // …and collapsed
  })

  it('counts unsequenced stream chunks as noise, not as events', () => {
    const home = tempHome()
    reset()
    const file = writeLog(home, 'sess-a', [frame([HEADER, chunk(), chunk('reasoning-chunks'), ...turn(1, completed)])])
    const log = readSessionLog(file)
    assert.equal(log.chunkLines, 2)
    assert.equal(log.events.some((e) => e.type === 'assistant/chunk'), false)
  })

  it('SPARSE seq is NOT read as incompleteness (the metric that lied)', () => {
    const home = tempHome()
    reset()
    const events = [
      ev('turn/start', { turn: 1 }, { sparse: 0 }),
      ev('step/start', { turn: 1, step: 0 }, { sparse: 5 }),
      ev('step/end', { turn: 1, step: 0 }, { sparse: 90 }),
      ev('turn/end', { turn: 1, reason: completed }, { sparse: 400 }),
    ]
    const file = writeLog(home, 'sess-a', [frame([HEADER]), frame(events)])
    const log = readSessionLog(file)

    assert.equal(log.events.length, 4)
    assert.equal(log.events.at(-1).seq - log.events[0].seq + 1 > log.events.length, true) // genuinely sparse
    assert.equal(log.balanced, true)
    assert.equal(log.complete, true)
  })

  it('detects an unpaired step as a structural anomaly', () => {
    const home = tempHome()
    reset()
    const broken = [ev('turn/start', { turn: 1 }), ev('step/start', { turn: 1, step: 0 })]
    const file = writeLog(home, 'sess-a', [frame([HEADER, ...broken])])
    const log = readSessionLog(file)

    assert.equal(log.balanced, false)
    assert.equal(log.complete, false)
    assert.deepEqual(log.mismatches, [{ pair: 'step/start:step/end', open: 1, close: 0 }])
  })

  it('flags a log that stopped mid-run, and accepts the legitimate closers', () => {
    const home = tempHome()
    reset()
    const midFlight = writeLog(home, 'sess-a', [frame([HEADER, ...turn(1, null), ev('approval/asked', { turn: 1 })])])
    assert.equal(readSessionLog(midFlight).endedMidFlight, true)
    assert.equal(readSessionLog(midFlight).lastEvent, 'approval/asked')

    reset()
    const sealed = writeLog(home, 'sess-b', [frame([HEADER, ...turn(1, completed), ev('session/end-seed', {})])])
    assert.equal(readSessionLog(sealed).endedMidFlight, false)

    reset()
    const done = writeLog(home, 'sess-c', [frame([HEADER, ...turn(1, completed)])])
    assert.equal(readSessionLog(done).endedMidFlight, false)
  })
})

describe('session discovery — migrations must not double-count', () => {
  it('elects one log per session, preferring the newer format', () => {
    const home = tempHome()
    reset()
    writeLog(home, 'sess-migrated', [frame([HEADER, ...turn(1, completed)])])
    reset()
    writeLog(home, 'sess-migrated', [frame([HEADER]), frame(turn(1, completed))], { name: 'session.v3.jsonl.zstd' })

    const logs = findSessionLogs(home)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].format, 'v3')
    assert.equal(logs[0].superseded, 1)
  })

  it('a migrated session contributes its turns once, not twice', () => {
    const home = tempHome()
    reset()
    writeLog(home, 'sess-migrated', [frame([HEADER, ...turn(1, completed)])])
    reset()
    writeLog(home, 'sess-migrated', [frame([HEADER]), frame(turn(1, completed))], { name: 'session.v3.jsonl.zstd' })

    const report = buildRunReport({ dshHome: home, scope: 'all' })
    assert.equal(report.scan.turns, 1)
    assert.equal(report.scan.logsRead, 1)
    assert.equal(report.scan.superseded, 1)
  })
})

describe('turn attribution', () => {
  const turnOf = (reason, extra = {}) => {
    reset()
    const events = turn(1, reason, extra)
    return { events, turns: analyzeTurns(events) }
  }

  it('maps every measured error signature to its class', () => {
    const cases = [
      ['TRANSPORT', 'DeepSeek API request to https://api.deepseek.com failed', 'provider-transport', 'F5a'],
      ['SERVER', '502 status code (no body)', 'provider-server', 'F5'],
      ['SERVER', '503 "pricing not configured for provider/model"', 'provider-pricing', 'F2b'],
      ['AUTH', '401: {"message":"The API Key appears to be invalid or may have expired."}', 'provider-auth', 'F1'],
      ['MISSING_CREDENTIAL', 'llm-deepseek: no API key for provider route "deepseek-official"', 'provider-missing-credential', 'F1b'],
      ['QUOTA', 'Insufficient Balance', 'provider-quota', 'F2'],
      ['INVALID_REQUEST', '400 "unsupported model"', 'model-unavailable', 'F4'],
      ['TIMEOUT', 'DeepSeek stream idle timeout after 300000ms', 'provider-timeout', 'F7'],
    ]
    for (const [code, message, expected, rule] of cases) {
      const { turns } = turnOf(errorOf(code, message))
      const verdict = classifyTurn(turns[0])
      assert.equal(verdict.class, expected, `${code}: ${message}`)
      assert.equal(verdict.rule, rule)
      assert.equal(verdict.severity, 'error')
      assert.equal(verdict.confidence, 'attributed')
    }
  })

  it('lets the message disambiguate an overloaded code', () => {
    const { turns } = turnOf(errorOf('SERVER', '503 "pricing not configured for provider/model"'))
    assert.equal(classifyTurn(turns[0]).class, 'provider-pricing')
  })

  it('an uncatalogued code is probable, never attributed', () => {
    const { turns } = turnOf(errorOf('SOMETHING_NEW', 'a brand new failure'))
    const verdict = classifyTurn(turns[0])
    assert.equal(verdict.class, 'provider-unknown')
    assert.equal(verdict.confidence, 'probable')
    assert.equal(verdict.slug, null) // no topic page to send the reader to
  })

  it('a deliberate stop is not a failure (never a red card)', () => {
    const { turns } = turnOf(abortedByUser)
    const verdict = classifyTurn(turns[0])
    assert.equal(verdict.verdict, 'aborted')
    assert.equal(verdict.severity, 'info')
    assert.equal(verdict.stoppedBy, 'user')
  })

  it('an interrupted turn is unclassified — the tool refuses to guess', () => {
    const { turns } = turnOf(interrupted)
    const verdict = classifyTurn(turns[0])
    assert.equal(verdict.verdict, 'interrupted')
    assert.equal(verdict.severity, 'unclassified')
    assert.equal(verdict.confidence, 'unclassified')
  })

  it('a turn with no turn/end is an orphan, not a guess', () => {
    const { turns } = turnOf(null)
    const verdict = classifyTurn(turns[0])
    assert.equal(verdict.class, 'orphan-turn')
    assert.equal(verdict.confidence, 'unclassified')
  })

  it('an unrecognised reason shape is unclassified', () => {
    const { turns } = turnOf({ kind: 'something-else' })
    const verdict = classifyTurn(turns[0])
    assert.equal(verdict.class, 'unknown-kind')
    assert.equal(verdict.confidence, 'unclassified')
  })
})

describe('side effects — what the dead turn left behind', () => {
  const withCalls = (calls, results) => {
    reset()
    return analyzeTurns(turn(1, errorOf('TRANSPORT', 'boom'), { toolCalls: calls, toolResults: results }))[0]
  }
  const verdict = { severity: 'error' }

  it('0 executed of N planned → nothing was written', () => {
    const effect = sideEffects(withCalls(6, 0), verdict)
    assert.equal(effect.class, 'no-side-effect')
    assert.equal(effect.rule, 'F3')
  })

  it('partial execution → files may be half-written', () => {
    const effect = sideEffects(withCalls(6, 3), verdict)
    assert.equal(effect.class, 'partial-side-effect')
    assert.equal(effect.rule, 'F6')
  })

  it('all tools ran → no side-effect finding', () => {
    assert.equal(sideEffects(withCalls(6, 6), verdict), null)
  })

  it('a completed turn never gets a side-effect finding', () => {
    assert.equal(sideEffects(withCalls(6, 0), { severity: 'ok' }), null)
  })
})

describe('incident detection — chronic noise vs a real event', () => {
  it('flags a day far above the median rate', () => {
    const byDay = {
      '2026-09-01': { turns: 100, errors: 2, byClass: { 'provider-transport': 2 } },
      '2026-09-02': { turns: 100, errors: 3, byClass: { 'provider-transport': 3 } },
      '2026-09-03': { turns: 10, errors: 8, byClass: { 'provider-transport': 8 } },
    }
    const { incidents, baseline } = detectIncidents(byDay)
    assert.equal(baseline, 0.03)
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].day, '2026-09-03')
    assert.equal(incidents[0].reasons[0].kind, 'failure-rate')
  })

  it('flags a first-ever failure class even on a quiet day', () => {
    const byDay = {
      '2026-09-01': { turns: 100, errors: 2, byClass: { 'provider-transport': 2 } },
      '2026-09-08': { turns: 100, errors: 3, byClass: { 'provider-pricing': 3 } },
    }
    const { incidents } = detectIncidents(byDay)
    assert.deepEqual(incidents.map((i) => i.day), ['2026-09-08'])
    assert.deepEqual(incidents[0].reasons[0], { kind: 'new-signature', classes: ['provider-pricing'] })
  })

  it('reports no incident when every day looks like the baseline', () => {
    const byDay = {}
    for (let d = 1; d <= 5; d++) byDay[`2026-09-0${d}`] = { turns: 100, errors: 3, byClass: { 'provider-transport': 3 } }
    assert.equal(detectIncidents(byDay).incidents.length, 0)
  })
})

describe('buildRunReport — the two scopes', () => {
  function fixtureHome() {
    const home = tempHome()
    reset()
    writeLog(home, 'sess-old', [frame([HEADER, ...turn(1, completed), ...turn(2, errorOf('TRANSPORT', 'DeepSeek API request to https://api.deepseek.com failed'))])])
    reset()
    writeLog(home, 'sess-new', [frame([HEADER, ...turn(1, completed), ...turn(2, completed), ...turn(3, abortedByUser)])])
    return home
  }

  it('latest reads only the newest session and separates abort from failure', () => {
    const report = buildRunReport({ dshHome: fixtureHome(), scope: 'latest' })
    assert.equal(report.scope, 'latest')
    assert.equal(report.scan.logsRead, 1)
    assert.equal(report.scan.turns, 3)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.summary.healthy, true)
    assert.equal(report.runs.filter((r) => r.verdict === 'aborted').length, 1)
  })

  it('all sees the failed run and counts it in the mix', () => {
    const report = buildRunReport({ dshHome: fixtureHome(), scope: 'all' })
    assert.equal(report.scan.logsRead, 2)
    assert.equal(report.summary.errors, 1)
    assert.equal(report.summary.healthy, false)
    assert.equal(report.mix.byClass['provider-transport'], 1)
    assert.equal(report.runs.find((r) => r.severity === 'error').topic, '/e/provider-transport/')
  })

  it('unclassified runs never gate the exit code', () => {
    const home = tempHome()
    reset()
    writeLog(home, 'sess-x', [frame([HEADER, ...turn(1, interrupted)])])
    const report = buildRunReport({ dshHome: home, scope: 'all' })
    assert.equal(report.summary.errors, 0)
    assert.equal(report.summary.unclassified, 1)
  })

  it('an empty DSH_HOME is reported, not crashed on', () => {
    const report = buildRunReport({ dshHome: tempHome(), scope: 'latest' })
    assert.equal(report.scan.logsRead, 0)
    assert.equal(report.latest, null)
    assert.equal(report.summary.healthy, true)
  })

  it('carries the provider message and log completeness into the report', () => {
    const report = buildRunReport({ dshHome: fixtureHome(), scope: 'all' })
    const failure = report.runs.find((r) => r.severity === 'error')
    assert.match(failure.message, /api\.deepseek\.com/)
    assert.equal(failure.code, 'TRANSPORT')
    assert.equal(failure.log.complete, true)
    assert.equal(failure.log.endedMidFlight, false)
  })
})

describe('renderRunText — same object, both faces', () => {
  function reportFor(reason) {
    const home = tempHome()
    reset()
    writeLog(home, 'sess-r', [frame([HEADER, ...turn(1, reason, { toolCalls: 4, toolResults: 1 })])])
    return buildRunReport({ dshHome: home, scope: 'all' })
  }

  it('renders a failure with its recovery steps and no ANSI when color is off', () => {
    const report = reportFor(errorOf('QUOTA', 'Insufficient Balance'))
    const text = renderRunText(report, 'en', '9.9.9', { color: false })
    assert.match(text, /run diagnostics/)
    assert.match(text, /the account is out of credit/)
    assert.match(text, /Recovery:/)
    assert.match(text, /top up the account/)
    assert.match(text, /1 of 4 tool call\(s\) had already run/)
    assert.equal(/\u001b\[/.test(text), false)
  })

  it('renders the unclassified promise instead of a verdict', () => {
    const text = renderRunText(reportFor(interrupted), 'en', '9.9.9', {})
    assert.match(text, /I will not guess/)
    assert.match(text, /UNCLASSIFIED/)
  })

  it('renders a deliberate stop as not-a-failure', () => {
    const text = renderRunText(reportFor(abortedByUser), 'zh', '9.9.9', {})
    assert.match(text, /运行诊断/)
    assert.match(text, /你主动停止/)
    assert.match(text, /主动停止永远不算故障/)
    // …and the single-run view spells out the reason shape it read.
    const home = tempHome()
    reset()
    writeLog(home, 'sess-abort', [frame([HEADER, ...turn(1, abortedByUser)])])
    const latest = renderRunText(buildRunReport({ dshHome: home, scope: 'latest' }), 'zh', '9.9.9', {})
    assert.match(latest, /"kind":"aborted"/)
  })

  it('the health view keeps the honesty tiers instead of swallowing them', () => {
    const text = renderRunText(reportFor(interrupted), 'en', '9.9.9', {})
    assert.match(text, /Unclassified \(1\)/)
    assert.match(text, /I will not guess/)
    // an unclassified run must not be presented as a failure anywhere
    assert.equal(/\[ERROR/.test(text), false)
  })

  it('renders the health view with the failure mix', () => {
    const text = renderRunText(reportFor(errorOf('TRANSPORT', 'DeepSeek API request to https://api.deepseek.com failed')), 'en', '9.9.9', {})
    assert.match(text, /scope: all sessions/)
    assert.match(text, /Failure mix/)
    assert.match(text, /provider-transport/)
  })

  it('an installer with no logs gets an explanation, not an empty page', () => {
    const text = renderRunText(buildRunReport({ dshHome: tempHome(), scope: 'latest' }), 'en', '9.9.9', {})
    assert.match(text, /No dsh session logs found/)
    assert.match(text, /session\.jsonl\.zstd/)
  })
})
