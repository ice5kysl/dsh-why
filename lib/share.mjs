/**
 * dsh-why — opt-in crash report sharing (--share).
 *
 * Privacy baseline (mirrors the collector's server-side whitelist): only
 * structured fields ever leave the machine — rule id, error signature hash,
 * shell version, plugin name+version, error code. Never user messages, tool
 * arguments, file paths, or prompt text. The exact payload is printed before
 * it is sent.
 *
 * Like every network path in dsh-why, sharing degrades to a plain "could not
 * send" line on any failure — a diagnostic tool never crashes on its own
 * telemetry.
 *
 * @module dsh-why/share
 */

import { createHash } from 'node:crypto'

export const SHARE_ENDPOINT = 'https://api.dsh-why.com/v1/report'

const RULE_CATEGORY = {
  R1: 'module-missing',
  R6: 'profile-boot',
}

/**
 * Build the collector-protocol v1 payload from a diagnosis report.
 * One payload per crash-level finding (those are the ones worth a case in the
 * corpus); null payload for reports with nothing crash-level.
 * @returns {Array<object>} whitelist-conform payloads (possibly empty)
 */
export function buildSharePayloads(report) {
  const findings = (report?.findings ?? []).filter((f) => f.severity === 'error')
  const shell = report?.install?.shellVersion ?? report?.install?.dshVersion ?? null
  if (!findings.length || typeof shell !== 'string' || !shell) return []

  return findings.map((f) => {
    const sigSource = [f.rule, f.plugin ?? '', f.reason ?? '', ...(f.missing ?? [])].join('|')
    const hash = createHash('sha256').update(sigSource).digest('hex').slice(0, 16)
    const payload = {
      v: 1,
      sig: `${String(f.rule ?? 'rx').toLowerCase()}_${hash}`,
      category: RULE_CATEGORY[f.rule] ?? 'other',
      shell,
    }
    if (typeof f.plugin === 'string' && f.plugin) {
      payload.plugin = f.plugin
      if (typeof f.version === 'string' && f.version) payload.plugin_ver = f.version
    }
    if (typeof f.rule === 'string' && f.rule) payload.code = f.rule
    return payload
  })
}

/**
 * POST one payload to the collector. Returns { ok, id?, error? } — never throws.
 */
export async function postShare(payload, { endpoint = SHARE_ENDPOINT, timeoutMs = 8000 } = {}) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'dsh-why (+https://dsh-why.com)' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await res.json().catch(() => null)
    if (res.ok && body?.ok) return { ok: true, id: body.id ?? null }
    return { ok: false, error: body?.error ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}
