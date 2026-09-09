/**
 * dsh-why — diagnosis rule base v1. Pure functions over a collected
 * environment model: no I/O, no network, everything injected by the caller.
 *
 *   R1 插件加载即崩 — an enabled plugin's client bundle has an UNGUARDED
 *       require that the current shell's module table cannot resolve
 *       (the "missed the module table" crash behind the "Failed to load
 *       plugins" red screen). Guard-aware: misses caught by a paired
 *       try/catch are reported as guarded notes, not crashes. Each missing
 *       module is annotated with its history across every published shell —
 *       removed-in / added-later / never-shipped — derived from the seed
 *       tables rather than hardcoded breakage points.
 *   R2 engines.dsh 不符 — the plugin's declared dsh range does not cover the
 *       installed dsh (warning; unparseable ranges degrade to a note).
 *   R3 有新版可升 — npm latest > installed (info; "upgrade first" is also the
 *       primary fix hint when R1 fired for the same plugin).
 *   R4 生态对照 — the dsh-insights.com observed-compat matrix: this plugin's
 *       measured verdict, its outcome at the running shell, and how many
 *       plugins ecosystem-wide miss the same module ("you are not alone").
 *   R5 未收录/未实测 — the plugin carries a client bundle but is absent from
 *       the matrix (neutral note, not a problem).
 *
 * @module dsh-why/rules
 */

import { compareVersions, resolvable, statusFor } from './scanner.mjs'
import { satisfies } from './semver.mjs'

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2, note: 3 }

/** When did a module enter/leave the module tables? Derived from the seed document, never hardcoded. */
export function moduleHistory(spec, versionsSorted, seedsByVersion) {
  const has = versionsSorted.filter((v) => seedsByVersion.get(v).has(spec))
  if (!has.length) return { kind: 'never' }
  return {
    kind: 'shipped',
    since: has[0],
    last: has[has.length - 1],
    removedIn: versionsSorted[versionsSorted.indexOf(has[has.length - 1]) + 1] ?? null,
  }
}

/** Pick the seed table row that best matches the running shell. */
export function resolveSeedVersion(shellVersion, versionsSorted) {
  if (!shellVersion || !versionsSorted.length) return { version: null, source: 'unavailable' }
  if (versionsSorted.includes(shellVersion)) return { version: shellVersion, source: 'exact' }
  const lower = versionsSorted.filter((v) => compareVersions(v, shellVersion) < 0)
  if (!lower.length) return { version: null, source: 'unavailable' }
  const version = lower[lower.length - 1]
  // The newest seed still predating the shell means the snapshot may miss
  // modules a newer shell added — a stronger caveat than an in-range gap.
  const source = compareVersions(shellVersion, versionsSorted[versionsSorted.length - 1]) > 0
    ? 'snapshot-older'
    : 'approx-lower'
  return { version, source }
}

/**
 * Count, ecosystem-wide, how many observed plugins miss `spec` on any
 * measured shell — the "you are not the only one who hit this" number.
 */
export function countEcosystemMissing(observed, spec) {
  if (!observed?.plugins) return null
  let count = 0
  for (const entry of Object.values(observed.plugins)) {
    for (const result of Object.values(entry.results ?? {})) {
      if (result?.status === 'broken' && result.missing?.includes(spec)) { count++; break }
    }
  }
  return count
}

function observedEntry(observed, name) {
  return observed?.plugins?.[name] ?? null
}

/** The matrix's measured outcome at one shell version (results axis only covers the distTag shells). */
function observedAtShell(entry, shellVersion) {
  return entry?.results?.[shellVersion] ?? null
}

/**
 * Run the rule base. All inputs are pre-collected/pre-fetched; `latest` and
 * `observed` are null in offline mode (or when the upstream is unreachable).
 */
export function diagnose({
  install,
  dshHome,
  profileData,
  availableProfiles = [],
  seeds,
  seedsOrigin = 'bundled',
  observed = null,
  latest = null,
  offline = false,
  now = new Date(),
}) {
  const report = {
    generatedAt: now.toISOString(),
    mode: offline ? 'offline' : 'online',
    dshHome,
    install: install
      ? { dshVersion: install.cliVersion, shellVersion: install.shellVersion, shellPkg: install.shellPkg }
      : null,
    profile: profileData?.profile ?? null,
    availableProfiles,
    seed: null,
    plugins: [],
    findings: [],
    summary: { errors: 0, warnings: 0, notes: 0, healthy: false },
  }

  if (!profileData?.manifestFound) return finalize(report)

  const versionsSorted = Object.keys(seeds?.versions ?? {}).sort(compareVersions)
  const seedsByVersion = new Map(versionsSorted.map((v) => [v, new Set(seeds.versions[v])]))
  const seedPick = resolveSeedVersion(install?.shellVersion, versionsSorted)
  report.seed = { version: seedPick.version, source: seedPick.source, origin: seedsOrigin }
  const seedSet = seedPick.version ? seedsByVersion.get(seedPick.version) : null

  const enabledPlugins = profileData.plugins.filter((p) => p.enabled)
  // Local registered factories ≈ the enabled plugins' package names (the
  // loader resolves "pkg/client" requires against them).
  const knownPkgs = new Set(enabledPlugins.map((p) => p.name))

  for (const plugin of profileData.plugins) {
    const row = {
      name: plugin.name,
      spec: plugin.spec,
      version: plugin.version,
      enabled: plugin.enabled,
      enginesDsh: plugin.enginesDsh,
      status: 'unknown',
      missing: [],
      guardedMissing: [],
      history: {},
      latest: null,
      upgradeAvailable: false,
      observed: null,
    }

    if (!plugin.enabled) {
      row.status = 'disabled'
      report.plugins.push(row)
      continue
    }

    if (!plugin.client) {
      row.status = plugin.version === null ? 'not-materialized' : 'no-client'
      report.plugins.push(row)
      continue
    }

    row.requires = plugin.client.requires

    // ── R1: unguarded requires vs the current shell's module table ──
    if (seedSet) {
      const verdict = statusFor(plugin.client.requiresV2, seedSet, plugin.name, knownPkgs)
      if (verdict.status === 'broken') {
        row.status = 'broken'
        row.missing = verdict.missing
        for (const spec of verdict.missing) {
          row.history[spec] = moduleHistory(spec, versionsSorted, seedsByVersion)
        }
      } else {
        row.status = 'ok'
      }
      // Guarded misses (try/catch-covered) are surfaced as information, never as crashes.
      for (const r of plugin.client.requiresV2) {
        if (r.guard === 'unguarded' || resolvable(r.spec, seedSet, plugin.name, knownPkgs)) continue
        if (row.missing.includes(r.spec) || row.guardedMissing.some((g) => g.spec === r.spec)) continue
        row.guardedMissing.push({ spec: r.spec, guard: r.guard })
      }
      if (row.status === 'ok' && row.guardedMissing.length) {
        report.findings.push({ rule: 'R1', severity: 'note', plugin: plugin.name, guardedMissing: row.guardedMissing })
      }
    } else {
      row.status = 'unknown' // no seed table applicable to this shell
    }

    // ── R2: engines.dsh vs the installed dsh ──
    if (plugin.enginesDsh && install?.cliVersion) {
      const ok = satisfies(install.cliVersion, plugin.enginesDsh)
      if (ok === false) {
        report.findings.push({
          rule: 'R2', severity: 'warning', plugin: plugin.name,
          enginesDsh: plugin.enginesDsh, dshVersion: install.cliVersion,
        })
      } else if (ok === null) {
        report.findings.push({
          rule: 'R2', severity: 'note', plugin: plugin.name,
          enginesDsh: plugin.enginesDsh, dshVersion: install.cliVersion, undecidable: true,
        })
      }
    }

    // ── R3: a newer release exists on npm ──
    const isLinked = /^(?:link|file|workspace):/.test(plugin.spec)
    if (latest && !isLinked) {
      const upstream = latest.get(plugin.name) ?? null
      row.latest = upstream
      if (upstream && plugin.version && compareVersions(upstream, plugin.version) > 0) {
        row.upgradeAvailable = true
        report.findings.push({
          rule: 'R3', severity: 'info', plugin: plugin.name,
          installed: plugin.version, latest: upstream,
        })
      }
    }

    // ── R4/R5: the observed-compat ecosystem matrix ──
    if (observed) {
      const entry = observedEntry(observed, plugin.name)
      if (entry) {
        row.observed = {
          verdict: entry.verdict?.cls ?? null,
          since: entry.verdict?.since ?? null,
          okUntil: entry.verdict?.okUntil ?? null,
          measuredVersion: entry.version ?? null,
          installedVersion: plugin.version,
          stale: Boolean(entry.version && plugin.version && entry.version !== plugin.version),
          atShell: install?.shellVersion ? observedAtShell(entry, install.shellVersion) : null,
          repo: entry.repo ?? null,
        }
      } else {
        // The matrix only lists plugins with a client bundle; absence for a
        // client-carrying plugin means "not observed", which is R5.
        report.findings.push({ rule: 'R5', severity: 'note', plugin: plugin.name })
      }
    }

    // R1 finding, enriched with R3/R4 context when available.
    if (row.status === 'broken') {
      const ecosystem = {}
      for (const spec of row.missing) {
        const count = countEcosystemMissing(observed, spec)
        if (count !== null) ecosystem[spec] = count
      }
      report.findings.push({
        rule: 'R1', severity: 'error', plugin: plugin.name,
        missing: row.missing,
        history: row.history,
        shellVersion: install?.shellVersion ?? null,
        seedVersion: seedPick.version,
        upgradeAvailable: row.upgradeAvailable,
        latest: row.latest,
        observed: row.observed,
        ecosystemMissing: ecosystem,
      })
    }

    report.plugins.push(row)
  }

  return finalize(report)
}

function finalize(report) {
  report.findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    || String(a.plugin).localeCompare(String(b.plugin)))
  report.summary = {
    errors: report.findings.filter((f) => f.severity === 'error').length,
    warnings: report.findings.filter((f) => f.severity === 'warning').length,
    notes: report.findings.filter((f) => f.severity === 'info' || f.severity === 'note').length,
    healthy: false,
  }
  report.summary.healthy = report.summary.errors === 0 && report.summary.warnings === 0
  return report
}
