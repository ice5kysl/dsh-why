/**
 * dsh-why — diagnosis orchestration: collect the environment, fetch the
 * online data sources (unless offline), run the rule base, and shape the
 * final report object consumed by both renderers (text / --json).
 *
 * @module dsh-why/diagnose
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  collectShellRows,
  detectDshInstall,
  listProfiles,
  readPackage,
  readProfile,
  resolveDshHome,
  resolveNpmGlobalRoot,
  selectProfile,
} from './collect.mjs'
import { parseErrorText } from './errparse.mjs'
import { fetchLatestVersions, loadCompatObserved, loadCrashCorpus, loadFixes, loadShellSeeds } from './net.mjs'
import { diagnose, diagnoseErrorRefs, resolveSeedVersion } from './rules.mjs'
import { compareVersions } from './scanner.mjs'
import { findingSig } from './share.mjs'

/** The bundled offline fallback snapshot of the shell module tables. */
function loadBundledSeeds() {
  try {
    const url = new URL('./data/shell-seeds.json', import.meta.url)
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch {
    return null
  }
}

/** The bundled offline fallback snapshot of the known-fix case base. */
function loadBundledFixes() {
  try {
    const url = new URL('./data/fixes.json', import.meta.url)
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Cross-check crash-level findings against the community crash corpus: each
 * error finding's deterministic sig — the same one --share would send — is
 * looked up, and a hit is attached as `corpusHit` for the text renderer and
 * --json. Advisory only: a miss (or no corpus at all) changes nothing.
 */
function attachCorpusHits(report, corpus) {
  if (!Array.isArray(corpus?.signatures) || !corpus.signatures.length) return
  const bySig = new Map(corpus.signatures.map((e) => [e?.sig, e]))
  for (const f of report.findings ?? []) {
    if (f.severity !== 'error') continue
    const entry = bySig.get(findingSig(f))
    if (entry) f.corpusHit = { sig: entry.sig, count: entry.count ?? 0, lastSeen: entry.lastSeen ?? null }
  }
}

/**
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.dshHome]   --dsh-home override
 * @param {string} [opts.profile]   --profile override
 * @param {string} [opts.packageDir] --package <dir> — pre-publish self-check of one plugin dir
 * @param {boolean} [opts.offline]  skip every network call
 * @param {string} [opts.errorText] pasted error text (--error / piped stdin)
 */
export async function runDiagnosis({ env = process.env, dshHome: dshHomeFlag, profile: profileFlag, packageDir = null, offline = false, errorText = null } = {}) {
  const npmRoot = resolveNpmGlobalRoot(env)
  const install = detectDshInstall(npmRoot)
  const dshHome = resolveDshHome(dshHomeFlag, env)
  // Graph rows from the local shell install (the loader's third resolution
  // branch — row bundles register package-name factories). null when unreadable.
  const rows = collectShellRows(npmRoot)
  // Test/mock hook, mirroring DSH_WHY_SHARE_ENDPOINT for --share.
  const corpusUrl = env.DSH_WHY_CRASH_CORPUS_URL || undefined

  // --error / stdin mode: diagnose the objects the pasted error references,
  // never the whole profile (the plugin may not be installed here at all).
  if (typeof errorText === 'string' && errorText.trim()) {
    const refs = parseErrorText(errorText)
    if (refs.recognized) {
      const { doc: seeds, origin: seedsOrigin } = await loadShellSeeds({ offline, bundled: loadBundledSeeds() })
      const [observed, fixesPick, corpus] = await Promise.all([
        loadCompatObserved({ offline }),
        loadFixes({ offline, bundled: loadBundledFixes() }),
        loadCrashCorpus({ offline, url: corpusUrl }),
      ])
      const report = diagnoseErrorRefs({
        refs, install, dshHome, seeds, seedsOrigin, observed, rows, offline,
        fixes: fixesPick.doc,
        fixesOrigin: fixesPick.origin,
      })
      attachCorpusHits(report, corpus)
      report.degraded = !offline && observed === null
      return report
    }
    if (!refs.bare) {
      // Honest unknown: environment context still helps; the report carries
      // the recognized-pattern list for the renderer.
      const { doc: seeds, origin: seedsOrigin } = await loadShellSeeds({ offline, bundled: loadBundledSeeds() })
      const versionsSorted = Object.keys(seeds?.versions ?? {}).sort(compareVersions)
      const seedPick = resolveSeedVersion(install?.shellVersion, versionsSorted)
      return {
        generatedAt: new Date().toISOString(),
        mode: offline ? 'offline' : 'online',
        unrecognizedError: errorText.trim().slice(0, 1000),
        dshHome,
        install: install
          ? { dshVersion: install.cliVersion, shellVersion: install.shellVersion, shellPkg: install.shellPkg }
          : null,
        profile: null,
        availableProfiles: [],
        seed: { version: seedPick.version, source: seedPick.source, origin: seedsOrigin, words: null },
        // The row model was collected even though this error was not parsed —
        // report it, so the env block says "unreadable" only when it really was.
        rows: rows ? { exact: rows.exact, immediate: rows.immediate, lazy: rows.lazy } : null,
        // the case base is not loaded on this path (nothing to attach it to)
        fixes: null,
        plugins: [],
        findings: [],
        summary: { errors: 0, warnings: 0, notes: 0, healthy: false },
        degraded: false,
      }
    }
    // bare "Failed to load plugins" with no refs → fall through to the full
    // diagnosis, flagged so the renderer can say why.
  }

  // --package <dir>: pre-publish self-check of ONE plugin directory (the
  // author's checkout), against the current dsh + the ecosystem data.
  if (packageDir) {
    const profileData = readPackage(packageDir)
    const { doc: seeds, origin: seedsOrigin } = await loadShellSeeds({ offline, bundled: loadBundledSeeds() })
    const [observed, fixesPick, corpus] = await Promise.all([
      loadCompatObserved({ offline }),
      loadFixes({ offline, bundled: loadBundledFixes() }),
      loadCrashCorpus({ offline, url: corpusUrl }),
    ])
    const report = diagnose({
      install, dshHome: packageDir, profileData, availableProfiles: [],
      seeds, seedsOrigin, observed, fixes: fixesPick.doc, fixesOrigin: fixesPick.origin,
      latest: null, rows, offline, packageMode: true,
    })
    attachCorpusHits(report, corpus)
    report.profileFound = profileData.manifestFound
    report.pluginCount = profileData.plugins.length
    report.enabledCount = profileData.plugins.filter((p) => p.enabled).length
    report.baseline = 0
    report.degraded = !offline && observed === null
    return report
  }

  const availableProfiles = listProfiles(dshHome)
  const { profile } = selectProfile(availableProfiles, profileFlag, env)
  const profileData = readProfile(profile, join(dshHome, 'profiles', profile))

  const { doc: seeds, origin: seedsOrigin } = await loadShellSeeds({ offline, bundled: loadBundledSeeds() })
  const [observed, fixesPick, corpus] = await Promise.all([
    loadCompatObserved({ offline }),
    loadFixes({ offline, bundled: loadBundledFixes() }),
    loadCrashCorpus({ offline, url: corpusUrl }),
  ])

  let latest = null
  if (!offline && profileData.manifestFound) {
    const names = profileData.plugins
      .filter((p) => p.enabled && !/^(?:link|file|workspace):/.test(p.spec))
      .map((p) => p.name)
    if (names.length) latest = await fetchLatestVersions(names)
  }

  const report = diagnose({
    install,
    dshHome,
    profileData,
    availableProfiles,
    seeds,
    seedsOrigin,
    observed,
    fixes: fixesPick.doc,
    fixesOrigin: fixesPick.origin,
    latest,
    rows,
    offline,
  })

  attachCorpusHits(report, corpus)
  report.profileFound = profileData.manifestFound
  report.pluginCount = profileData.plugins.length
  report.enabledCount = profileData.plugins.filter((p) => p.enabled).length
  report.baseline = profileData.baseline
  if (typeof errorText === 'string' && errorText.trim()) report.bareErrorFallback = true
  // "degraded" = online was requested but the ecosystem matrix did not arrive;
  // the local rule base still produced a full diagnosis.
  report.degraded = !offline && observed === null
  return report
}
