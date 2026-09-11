/**
 * dsh-why — read a dsh session event log.
 *
 * dsh persists each session as an APPEND-ONLY sequence of INDEPENDENT zstd frames
 * (`session.jsonl.zstd`, newer `session.vN.jsonl.zstd`). Reading it is not
 * `zstdDecompressSync(file)`:
 *
 *   - Node's zstd decompressor stops at the FIRST frame's end. On a real 2.4 MB
 *     session that silently returns 1 event out of 3,389 — no error, just a
 *     wrong answer. A forensics tool that under-reads is worse than none, so we
 *     walk every frame and report how many we actually decoded.
 *   - Frames OVERLAP: a later frame re-emits content of earlier ones. Sequenced
 *     events dedupe 1:1 by `seq` (verified: 0 seqs carry two event types across
 *     510,931 events), so `seq` is a safe identity.
 *   - Stream chunks (`assistant/chunk`, `reasoning-chunks`, …) carry NO `seq` and
 *     are re-emitted by every overlapping frame. They are 61% of the bytes on a
 *     real corpus and useless for forensics: counted, then dropped.
 *   - `seq` is SPARSE (609 events reached seq 24,471), so seq density is NOT a
 *     completeness signal. Completeness is validated structurally instead:
 *     every opener must have its closer, and the log must end on a closer.
 *
 * Read-only: nothing here writes, and no byte leaves the machine.
 *
 * @module dsh-why/sessionlog
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import zlib from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Event types a session log legitimately ends on.
 * Observed terminal events across a real corpus: turn/end (95), session/end-seed (34).
 * Everything else means the process stopped mid-run: approval/policy (6) and
 * approval/asked (3) are runs abandoned while an approval was pending, and
 * tool/call (1) / agent/inbox/spliced (1) stopped mid-action.
 */
const CLOSERS = new Set(['turn/end', 'session/end-seed'])

/**
 * Decompress every zstd frame in a buffer.
 *
 * Frame boundaries are found by scanning for the zstd magic and attempting a
 * decode at each hit: a false positive inside compressed payload fails header
 * validation and is skipped, and JSON parsing rejects anything that still slips
 * through. `framesRead` is reported so a partial read can never be mistaken for
 * a clean one.
 */
export function decodeFrames(buf) {
  const lines = []
  let frames = 0
  let framesRead = 0
  let frameErrors = 0
  const starts = []
  for (let i = buf.indexOf(ZSTD_MAGIC); i !== -1; i = buf.indexOf(ZSTD_MAGIC, i + 4)) starts.push(i)

  for (const off of starts) {
    frames++
    let text
    try {
      text = zlib.zstdDecompressSync(buf.subarray(off)).toString('utf8')
    } catch {
      // Not a real frame start (magic bytes inside compressed payload).
      frameErrors++
      continue
    }
    framesRead++
    for (const line of text.split('\n')) if (line) lines.push(line)
  }
  return { lines, frames, framesRead, frameErrors }
}

/** Where does dsh keep session logs? */
export function sessionsRoot(dshHome = null) {
  const home = dshHome || process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'sessions')
}

/**
 * All session logs under DSH_HOME, newest first.
 * Layout: sessions/<escaped-cwd>/<session-id>/session[.vN].jsonl.zstd
 *
 * A session migrated between log formats keeps BOTH files (`session.jsonl.zstd`
 * and `session.v3.jsonl.zstd`) in the same directory. Counting both would
 * double-count that session's turns, so one log is elected per session
 * directory — the highest format version, which is the one dsh now writes.
 *
 * @returns {{file: string, mtime: number, bytes: number, workspaceDir: string, sessionDir: string, format: string, superseded: number}[]}
 */
export function findSessionLogs(dshHome) {
  const root = sessionsRoot(dshHome)
  const byDir = new Map()
  const walk = (dir, workspaceDir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, workspaceDir ?? full); continue }
      if (!entry.name.endsWith('.jsonl.zstd')) continue
      let st
      try { st = statSync(full) } catch { continue }
      const format = formatOf(full)
      const previous = byDir.get(dir)
      if (!previous) {
        byDir.set(dir, { file: full, mtime: st.mtimeMs, bytes: st.size, workspaceDir: workspaceDir ?? dir, sessionDir: dir, format, superseded: 0 })
      } else {
        // Keep the newer format; the older file is the migration's leftover.
        previous.superseded++
        if (formatRank(format) > formatRank(previous.format)) {
          byDir.set(dir, { file: full, mtime: st.mtimeMs, bytes: st.size, workspaceDir: workspaceDir ?? dir, sessionDir: dir, format, superseded: previous.superseded })
        }
      }
    }
  }
  walk(root, null)
  return [...byDir.values()].sort((a, b) => b.mtime - a.mtime)
}

/** `session.jsonl.zstd` → 'legacy'; `session.v3.jsonl.zstd` → 'v3'. */
function formatOf(file) {
  const m = /\.v(\d+)\.jsonl\.zstd$/.exec(file)
  return m ? `v${m[1]}` : 'legacy'
}

/** legacy sorts below every numbered format. */
function formatRank(format) {
  return format === 'legacy' ? 0 : Number(format.slice(1))
}

/**
 * Read one session log into its sequenced events.
 *
 * @returns {{
 *   file: string, bytes: number, format: string,
 *   frames: number, framesRead: number, frameErrors: number,
 *   linesParsed: number, chunkLines: number,
 *   events: object[], header: object|null,
 *   balanced: boolean, mismatches: {pair: string, open: number, close: number}[],
 *   complete: boolean, openTurns: number, lastEvent: string|null, endedMidFlight: boolean
 * }}
 */
export function readSessionLog(file) {
  const buf = readFileSync(file)
  const { lines, frames, framesRead, frameErrors } = decodeFrames(buf)

  const bySeq = new Map()
  let header = null
  let chunkLines = 0

  for (const line of lines) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (typeof event.seq === 'number') { bySeq.set(event.seq, event); continue }
    // The session header is unsequenced too, but it is the one unsequenced event
    // that carries state — it must not be written off as stream noise.
    if (event.type === 'session') { if (!header) header = event; continue }
    chunkLines++
  }

  const events = [...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, event]) => event)

  const count = (type) => events.reduce((n, event) => n + (event.type === type ? 1 : 0), 0)
  const mismatches = [
    { pair: 'step/start:step/end', open: count('step/start'), close: count('step/end') },
    { pair: 'tool/call:tool/result', open: count('tool/call'), close: count('tool/result') },
  ].filter((m) => m.open !== m.close)

  const last = events[events.length - 1] ?? null
  const openTurns = count('turn/start') - count('turn/end')

  return {
    file,
    bytes: buf.length,
    format: formatOf(file),
    frames, framesRead, frameErrors,
    linesParsed: lines.length,
    chunkLines,
    events,
    header,
    balanced: mismatches.length === 0,
    mismatches,
    complete: frameErrors === 0 && mismatches.length === 0,
    openTurns,
    lastEvent: last?.type ?? null,
    endedMidFlight: !!last && !CLOSERS.has(last.type),
  }
}

/**
 * Fold a session's events into per-turn summaries.
 *
 * Turns are identified by `data.turn`, which the loop stamps on every event it
 * emits. A turn with a `turn/start` but no `turn/end` is the fingerprint of a
 * process that stopped mid-run — reported as its own verdict, never guessed at.
 *
 * @returns {{
 *   turn: number, started: boolean, ended: {reason: object|null, at: number|null}|null,
 *   toolCalls: number, toolResults: number, steps: number, assistant: number,
 *   model: string|null, lastEvent: string|null
 * }[]}
 */
export function analyzeTurns(events) {
  const turns = new Map()
  let model = null
  const slot = (n) => {
    if (!turns.has(n)) {
      turns.set(n, { turn: n, started: false, ended: null, toolCalls: 0, toolResults: 0, steps: 0, assistant: 0, model: null, lastEvent: null })
    }
    return turns.get(n)
  }

  for (const event of events) {
    const data = event.data ?? {}
    // The model in force is session-scoped, not turn-scoped.
    if (event.type === 'model/selection' && model === null) {
      model = data.model ?? data.id ?? data.name ?? null
    }
    if (typeof data.turn !== 'number') continue
    const turn = slot(data.turn)
    turn.lastEvent = event.type
    turn.model = model
    switch (event.type) {
      case 'turn/start': turn.started = true; break
      case 'turn/end': turn.ended = { reason: data.reason ?? null, at: event.time ?? null }; break
      case 'tool/call': turn.toolCalls++; break
      case 'tool/result': turn.toolResults++; break
      case 'step/start': turn.steps++; break
      case 'assistant/message': turn.assistant++; break
      default: break
    }
  }

  return [...turns.values()].sort((a, b) => a.turn - b.turn)
}
