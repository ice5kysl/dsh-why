/**
 * dsh-why — minimal semver range satisfaction for engines.dsh checks.
 *
 * Deliberately pragmatic about prereleases: dsh ships almost exclusively
 * prerelease versions (0.1.2-rc.1, 0.1.5-alpha.1), and plugin authors declare
 * ranges like "^0.1.1" that are intended to cover them. npm's strict
 * prerelease-tuple exclusion would flag nearly every real-world install, so
 * comparators are evaluated directly with compareVersions — a version
 * satisfies ">=0.1.1 <0.2.0" whether or not it carries a prerelease tag.
 *
 * Supported: `*`, exact, `^x.y.z`, `~x.y.z`, `>=`/`>`/`<=`/`</`=` prefixes,
 * space-separated AND, `||` OR. Anything unparseable answers `null`
 * (undecidable) rather than guessing — the caller reports it as unknown.
 *
 * @module dsh-why/semver
 */

import { compareVersions } from './scanner.mjs'

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function isVersion(value) {
  return typeof value === 'string' && VERSION_RE.test(value)
}

/** Partial versions ("0.1", "0") are padded; anything else returns null. */
function normalizeVersion(value) {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/)
  if (!m) return null
  return `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}${m[4] ?? ''}`
}

function compareWithMood(mood, version, bound) {
  const cmp = compareVersions(version, bound)
  switch (mood) {
    case '>': return cmp > 0
    case '>=': return cmp >= 0
    case '<': return cmp < 0
    case '<=': return cmp <= 0
    default: return cmp === 0 // '='
  }
}

/** One comparator set (space-separated AND). Returns true/false, or null when a token is unparseable. */
function satisfiesSet(version, set) {
  const tokens = set.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  for (const token of tokens) {
    if (token === '*' || token === 'x' || token === 'X') continue
    const m = token.match(/^(\^|~|>=|<=|>|<|=)?\s*(.+)$/)
    if (!m) return null
    const [, op, raw] = m
    const base = normalizeVersion(raw)
    if (!base) return null
    if (op === '^') {
      const [major, minor] = base.split('.').map(Number)
      // caret: <(major+1).0.0 for major>0, <0.(minor+1).0 for 0.x
      const upper = major > 0 ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`
      if (!(compareVersions(version, base) >= 0 && compareVersions(version, upper) < 0)) return false
      continue
    }
    if (op === '~') {
      const [major, minor] = base.split('.').map(Number)
      const upper = `${major}.${minor + 1}.0`
      if (!(compareVersions(version, base) >= 0 && compareVersions(version, upper) < 0)) return false
      continue
    }
    if (!compareWithMood(op || '=', version, base)) return false
  }
  return true
}

/**
 * Does `version` satisfy `range`? Returns true/false, or null when the range
 * cannot be parsed (callers surface that as "undecidable", not a violation).
 */
export function satisfies(version, range) {
  if (!isVersion(version) || typeof range !== 'string' || !range.trim()) return null
  const branches = range.split('||')
  let sawUndecidable = false
  for (const branch of branches) {
    const result = satisfiesSet(version, branch)
    if (result === true) return true
    if (result === null) sawUndecidable = true
  }
  return sawUndecidable ? null : false
}
