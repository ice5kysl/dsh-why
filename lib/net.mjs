/**
 * dsh-why — network access, all optional and all degradable.
 *
 * Online mode consults two upstreams; every failure returns null and the
 * diagnosis continues on the local rule base (a diagnostic tool must work on
 * a machine whose network is the thing being diagnosed):
 *   - https://dsh-insights.com/data/shell-seeds.json      (fresh module tables)
 *   - https://dsh-insights.com/data/compat-observed.json  (observed matrix)
 *   - https://registry.npmjs.org/<name>/latest            (upgrade hints)
 *
 * @module dsh-why/net
 */

// No version segment: this module is browser-safe and must not import fs to
// read package.json (it used to hardcode a version that went stale).
const UA = 'dsh-why (+https://dsh-why.com)'
const TIMEOUT_MS = 8000

export const URLS = {
  shellSeeds: 'https://dsh-insights.com/data/shell-seeds.json',
  compatObserved: 'https://dsh-insights.com/data/compat-observed.json',
  fixes: 'https://dsh-insights.com/data/fixes.json',
  npmLatest: (name) => `https://registry.npmjs.org/${encodeURIComponent(name).replace('%2F', '/')}/latest`,
}

/** fetchJson with a hard timeout; null on any failure (offline, 404, bad JSON). */
export async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const parsed = await res.json()
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/**
 * The freshest shell-seeds document: upstream when online, else the bundled
 * snapshot. Returns { doc, origin: 'upstream' | 'bundled' } — null doc only
 * when both are unavailable (bundled data is shipped, so this is defensive).
 */
export async function loadShellSeeds({ offline, bundled }) {
  if (!offline) {
    const doc = await fetchJson(URLS.shellSeeds)
    if (doc?.versions && Object.keys(doc.versions).length) return { doc, origin: 'upstream' }
  }
  return { doc: bundled, origin: 'bundled' }
}

/** The observed-compat matrix document; null when offline or unreachable. */
export async function loadCompatObserved({ offline }) {
  if (offline) return null
  const doc = await fetchJson(URLS.compatObserved, 15_000)
  return doc?.plugins ? doc : null
}

/**
 * The known-fix case base (editorially maintained, keyed by missing module):
 * upstream when online, else the bundled snapshot — a machine that cannot
 * reach the network is exactly the machine that needs the local fix recipes.
 * Returns { doc, origin: 'upstream' | 'bundled' }; doc is null only when the
 * upstream is unreachable AND no snapshot is shipped (defensive — the snapshot
 * is part of the package). Absence is never an error: the R1 fix section then
 * just stays direction-level.
 */
export async function loadFixes({ offline, bundled }) {
  if (!offline) {
    const doc = await fetchJson(URLS.fixes)
    if (doc?.modules && typeof doc.modules === 'object') return { doc, origin: 'upstream' }
  }
  return { doc: bundled?.modules && typeof bundled.modules === 'object' ? bundled : null, origin: 'bundled' }
}

/** npm `latest` versions for the given package names; unknown names map to null. Small concurrency pool. */
export async function fetchLatestVersions(names, { concurrency = 4 } = {}) {
  const out = new Map()
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, names.length) || 1 }, async () => {
    while (i < names.length) {
      const name = names[i++]
      const doc = await fetchJson(URLS.npmLatest(name))
      out.set(name, typeof doc?.version === 'string' ? doc.version : null)
    }
  })
  await Promise.all(workers)
  return out
}
