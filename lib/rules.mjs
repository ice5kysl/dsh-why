/**
 * dsh-why — diagnosis rule base v1. Pure functions over a collected
 * environment model: no I/O, no network, everything injected by the caller.
 *
 *   R1 插件加载即崩 — an enabled plugin's client bundle has an UNGUARDED
 *       require that the current shell cannot resolve (the "missed the module
 *       table" crash behind the "Failed to load plugins" red screen).
 *       Three tiers, mirroring the loader's own branch order (seed word →
 *       materialized module → registered factory):
 *         error       (missing)     nothing in this install can answer it
 *         warning     (conditional) a built-in graph ROW the plugin did not
 *                                   declare — resolves by batch timing
 *         warning     (unknown)     the row branch could not be read at all,
 *                                   so the spec is neither confirmed nor denied
 *       Both warning flavors stay out of the exit code and the issue template:
 *       a diagnostic tool must never turn its own blind spot into a red card.
 *       Guard-aware: misses caught by a paired try/catch are guarded notes, not
 *       crashes. Each affected module is annotated with its history across
 *       every published shell — removed-in / added-later / never-shipped —
 *       derived from the seed tables rather than hardcoded breakage points.
 *   R2 engines.dsh 不符 — the plugin's declared dsh range does not cover the
 *       installed dsh (warning; unparseable ranges degrade to a note).
 *   R3 有新版可升 — npm latest > installed (info; "upgrade first" is also the
 *       primary fix hint when R1 fired for the same plugin).
 *   R4 生态对照 — the dsh-insights.com observed-compat matrix: this plugin's
 *       measured verdict, its outcome at the running shell, and how many
 *       plugins ecosystem-wide miss the same module ("you are not alone").
 *   R5 未收录/未实测 — the plugin carries a client bundle but is absent from
 *       the matrix (neutral note, not a problem).
 *   R6 profile 完整性 — a declared (and enabled) plugin whose node_modules
 *       entry is gone or unreadable crashes dsh at boot (the "uninstalled a
 *       plugin and now it won't start" class); half-uninstalled leftovers
 *       (a plugin on disk declared nowhere) are warnings. Symlinks are
 *       followed via realpath — healthy pnpm links are never misflagged.
 *
 * diagnoseErrorRefs() powers --error/stdin mode: diagnose the plugins and
 * modules parsed out of a pasted error text even when they are NOT installed
 * locally (the user may be debugging an install that never materialized).
 *
 * @module dsh-why/rules
 */

import { classify, compareVersions, resolvable, rowIndex, statusFor } from './scanner.mjs'
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
  fixes = null,
  latest = null,
  rows = null,
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
  report.seed.words = seedSet ? [...seedSet] : null // current table contents — the --prompt seed-safe constraint

  const enabledPlugins = profileData.plugins.filter((p) => p.enabled)
  // Local registered factories ≈ the enabled plugins' package names (the
  // loader resolves "pkg/client" requires against them).
  const knownPkgs = new Set(enabledPlugins.map((p) => p.name))
  // Graph rows from the local shell install: row bundles register factories
  // under their package name when their combo batch executes — resolvable
  // without being seed words. immediate rows are prefetched before any plugin
  // materializes (deterministic); lazy rows resolve in practice but carry no
  // ordering guarantee unless the plugin declares them in dsh.client.
  // `known: false` (the install tree was unreadable) makes classify() answer
  // 'unknown': the row branch is unobservable, so a require it cannot judge is
  // reported as a warning, never as a crash.
  const rowIdx = rowIndex(rows)
  report.rows = rows
    ? { exact: rowIdx.exact, immediate: [...rowIdx.immediate].sort(), lazy: [...rowIdx.lazy].sort() }
    : null

  for (const plugin of profileData.plugins) {
    const row = {
      name: plugin.name,
      spec: plugin.spec,
      version: plugin.version,
      enabled: plugin.enabled,
      materialized: plugin.materialized,
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
      const declared = new Set(plugin.declaredDeps ?? [])
      const verdict = statusFor(plugin.client.requiresV2, seedSet, plugin.name, knownPkgs, rowIdx, declared)
      if (verdict.status === 'broken') {
        row.status = 'broken'
        row.missing = verdict.missing
        if (verdict.conditional?.length) row.conditional = verdict.conditional
        if (verdict.unknown?.length) row.unknown = verdict.unknown
        for (const spec of verdict.missing) {
          row.history[spec] = moduleHistory(spec, versionsSorted, seedsByVersion)
        }
      } else if (verdict.status === 'conditional') {
        row.status = 'conditional'
        if (verdict.conditional.length) row.conditional = verdict.conditional
        if (verdict.unknown.length) row.unknown = verdict.unknown
      } else {
        row.status = 'ok'
      }
      // Guarded misses (try/catch-covered) are surfaced as information, never as crashes.
      for (const r of plugin.client.requiresV2) {
        if (r.guard === 'unguarded' || classify(r.spec, seedSet, plugin.name, knownPkgs, rowIdx, declared) === 'ok') continue
        if (row.missing.includes(r.spec) || (row.conditional ?? []).includes(r.spec) || (row.unknown ?? []).includes(r.spec) || row.guardedMissing.some((g) => g.spec === r.spec)) continue
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

    // R1 finding, enriched with R3/R4 context and the known-fix case base.
    if (row.status === 'broken') {
      const ecosystem = {}
      for (const spec of row.missing) {
        const count = countEcosystemMissing(observed, spec)
        if (count !== null) ecosystem[spec] = count
      }
      // fixes.json: event-level repair guidance for the missing modules.
      // Only modules present in the case base get an entry; the whole block
      // is omitted (not emptied) when nothing hits or the doc is absent.
      const knownFixes = {}
      for (const spec of row.missing) {
        const entry = fixes?.modules?.[spec]
        if (!entry) continue
        knownFixes[spec] = {
          status: entry.status ?? null,
          fix: entry.fix ?? null,
          cases: (Array.isArray(entry.cases) ? entry.cases : [])
            .map((c) => ({ repo: c.repo ?? null, url: c.url ?? null, note: c.note ?? null })),
        }
      }
      const finding = {
        rule: 'R1', severity: 'error', plugin: plugin.name,
        missing: row.missing,
        history: row.history,
        shellVersion: install?.shellVersion ?? null,
        seedVersion: seedPick.version,
        upgradeAvailable: row.upgradeAvailable,
        latest: row.latest,
        observed: row.observed,
        ecosystemMissing: ecosystem,
      }
      if (Object.keys(knownFixes).length) finding.knownFixes = knownFixes
      report.findings.push(finding)
    }

    // R1 conditional / unclassifiable — two flavors, one severity:
    //   undeclared-lazy-row      a built-in graph row the plugin did not
    //                            declare: resolves by batch timing, one
    //                            dsh.client.external away from certain;
    //   row-model-unavailable    the install tree could not be read, so the
    //                            row branch is unobservable and the spec is
    //                            neither confirmed nor denied.
    // Both are warning level: neither may ever flip the exit code into a
    // crash verdict. Unknown specs still carry their module history so the
    // reader can see which side they would land on.
    if (row.status === 'conditional') {
      const conditional = row.conditional ?? []
      const unknown = row.unknown ?? []
      const finding = {
        rule: 'R1',
        severity: 'warning',
        plugin: plugin.name,
        reason: unknown.length ? 'row-model-unavailable' : 'undeclared-lazy-row',
        shellVersion: install?.shellVersion ?? null,
      }
      if (conditional.length) finding.conditional = conditional
      if (unknown.length) {
        finding.unknown = unknown
        finding.history = {}
        for (const spec of unknown) finding.history[spec] = moduleHistory(spec, versionsSorted, seedsByVersion)
      }
      report.findings.push(finding)
    }

    report.plugins.push(row)
  }

  // ── R6: profile integrity — a declared (and enabled) plugin whose
  // node_modules entry is gone crashes dsh at boot (the "uninstalled a
  // plugin and now dsh won't start" class); leftovers are warning-level.
  for (const plugin of profileData.plugins) {
    if (plugin.materialized) continue
    report.findings.push({
      rule: 'R6',
      severity: plugin.enabled ? 'error' : 'warning',
      plugin: plugin.name,
      spec: plugin.spec,
      enabled: plugin.enabled,
    })
  }
  for (const name of profileData.leftovers ?? []) {
    report.findings.push({ rule: 'R6', severity: 'warning', plugin: name, leftover: true })
  }

  return finalize(report)
}

/**
 * Error-reference diagnosis (--error / stdin): the refs come from a pasted
 * error text, not from the local profile — the plugin may not be installed
 * here at all. Module refs get the R1 treatment (history + ecosystem count +
 * known fixes) against the current shell; plugin refs get the R4/R5 matrix
 * treatment. A module that IS resolvable on the current shell means the
 * pasted error came from an older build — reported as such, not as a crash.
 */
export function diagnoseErrorRefs({
  refs,
  install,
  dshHome = null,
  seeds,
  seedsOrigin = 'bundled',
  observed = null,
  fixes = null,
  rows = null,
  offline = false,
  now = new Date(),
}) {
  const report = {
    generatedAt: now.toISOString(),
    mode: offline ? 'offline' : 'online',
    errorRefs: { plugins: refs.plugins, modules: refs.modules, matched: refs.matched },
    dshHome,
    install: install
      ? { dshVersion: install.cliVersion, shellVersion: install.shellVersion, shellPkg: install.shellPkg }
      : null,
    profile: null,
    availableProfiles: [],
    seed: null,
    plugins: [],
    findings: [],
    summary: { errors: 0, warnings: 0, notes: 0, healthy: false },
  }

  const versionsSorted = Object.keys(seeds?.versions ?? {}).sort(compareVersions)
  const seedsByVersion = new Map(versionsSorted.map((v) => [v, new Set(seeds.versions[v])]))
  const seedPick = resolveSeedVersion(install?.shellVersion, versionsSorted)
  report.seed = { version: seedPick.version, source: seedPick.source, origin: seedsOrigin }
  const seedSet = seedPick.version ? seedsByVersion.get(seedPick.version) : null
  report.seed.words = seedSet ? [...seedSet] : null

  const pluginName = refs.plugins[0] ?? null
  const pluginEntry = pluginName ? observedEntry(observed, pluginName) : null

  const rowIdx = rowIndex(rows)
  report.rows = rows
    ? { exact: rowIdx.exact, immediate: [...rowIdx.immediate].sort(), lazy: [...rowIdx.lazy].sort() }
    : null

  for (const spec of refs.modules) {
    const clsNow = seedSet ? classify(spec, seedSet, null, new Set(), rowIdx) : null
    // 'unknown' (rows unreadable) stays a warning: the pasted error proves
    // something failed once, but this shell cannot be checked either way, so
    // calling it a crash would be a guess.
    const resolvableNow = clsNow === null ? null
      : clsNow === 'ok' ? true
        : clsNow === 'conditional' ? 'conditional'
          : clsNow === 'unknown' ? 'unknown'
            : false
    const history = { [spec]: moduleHistory(spec, versionsSorted, seedsByVersion) }
    const ecosystem = {}
    const count = countEcosystemMissing(observed, spec)
    if (count !== null) ecosystem[spec] = count
    const fixEntry = fixes?.modules?.[spec]
    // Same `reason` vocabulary as the profile path so the summary counters and
    // the CI contract hold in --error mode too: an unresolvable module that
    // this shell could not check is 'row-model-unavailable', and one that IS a
    // row of this shell is 'module-is-graph-row' (the pasted error is then
    // timing-dependent, or came from an older build).
    const reason = resolvableNow === 'unknown' ? 'row-model-unavailable'
      : resolvableNow === 'conditional' ? 'module-is-graph-row'
        : null
    const finding = {
      rule: 'R1',
      severity: resolvableNow === false ? 'error' : 'warning',
      plugin: pluginName,
      fromError: true,
      ...reason ? { reason } : {},
      missing: [spec],
      resolvableNow,
      history,
      shellVersion: install?.shellVersion ?? null,
      seedVersion: seedPick.version,
      ecosystemMissing: ecosystem,
      observed: pluginEntry
        ? {
            verdict: pluginEntry.verdict?.cls ?? null,
            since: pluginEntry.verdict?.since ?? null,
            okUntil: pluginEntry.verdict?.okUntil ?? null,
            measuredVersion: pluginEntry.version ?? null,
            stale: false,
            atShell: install?.shellVersion ? observedAtShell(pluginEntry, install.shellVersion) : null,
            repo: pluginEntry.repo ?? null,
          }
        : null,
    }
    if (fixEntry) {
      finding.knownFixes = {
        [spec]: {
          status: fixEntry.status ?? null,
          fix: fixEntry.fix ?? null,
          cases: (Array.isArray(fixEntry.cases) ? fixEntry.cases : [])
            .map((c) => ({ repo: c.repo ?? null, url: c.url ?? null, note: c.note ?? null })),
        },
      }
    }
    report.findings.push(finding)
  }

  for (const name of refs.plugins) {
    const entry = observedEntry(observed, name)
    if (!entry) {
      if (observed) report.findings.push({ rule: 'R5', severity: 'note', plugin: name, fromError: true })
      continue
    }
    const observedRow = {
      verdict: entry.verdict?.cls ?? null,
      since: entry.verdict?.since ?? null,
      okUntil: entry.verdict?.okUntil ?? null,
      measuredVersion: entry.version ?? null,
      stale: false,
      atShell: install?.shellVersion ? observedAtShell(entry, install.shellVersion) : null,
      repo: entry.repo ?? null,
    }
    const atShell = observedRow.atShell?.status
    const severity = atShell === 'broken'
      ? 'error'
      : atShell === 'conditional'
        ? 'warning'
        : atShell === 'ok'
          ? 'note' // measured fine at this shell — the error likely predates a fix
          : observedRow.verdict === 'never'
            ? 'error'
            : observedRow.verdict === 'ok'
              ? 'note'
              : 'warning'
    report.findings.push({ rule: 'R4', severity, plugin: name, fromError: true, observed: observedRow })
  }

  return finalize(report)
}

function finalize(report) {
  report.findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    || String(a.plugin).localeCompare(String(b.plugin)))
  // conditional / unclassified split the R1 warning class so CI can tell
  // "risky but real" from "could not be decided" — both are already counted
  // in warnings, and neither ever flips the exit code. The two flavors exist in
  // profile mode ('undeclared-lazy-row' / 'row-model-unavailable') and in
  // --error mode ('module-is-graph-row' / 'row-model-unavailable').
  report.summary = {
    errors: report.findings.filter((f) => f.severity === 'error').length,
    warnings: report.findings.filter((f) => f.severity === 'warning').length,
    notes: report.findings.filter((f) => f.severity === 'info' || f.severity === 'note').length,
    conditional: report.findings.filter((f) => f.reason === 'undeclared-lazy-row' || f.reason === 'module-is-graph-row').length,
    unclassified: report.findings.filter((f) => f.reason === 'row-model-unavailable').length,
    healthy: false,
  }
  report.summary.healthy = report.summary.errors === 0 && report.summary.warnings === 0
  return report
}
