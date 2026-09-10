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
  readProfile,
  resolveDshHome,
  resolveNpmGlobalRoot,
  selectProfile,
} from './collect.mjs'
import { parseErrorText } from './errparse.mjs'
import { fetchLatestVersions, loadCompatObserved, loadFixes, loadShellSeeds } from './net.mjs'
import { diagnose, diagnoseErrorRefs, resolveSeedVersion } from './rules.mjs'
import { compareVersions } from './scanner.mjs'

/** The bundled offline fallback snapshot of the shell module tables. */
function loadBundledSeeds() {
  try {
    const url = new URL('./data/shell-seeds.json', import.meta.url)
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.dshHome]   --dsh-home override
 * @param {string} [opts.profile]   --profile override
 * @param {boolean} [opts.offline]  skip every network call
 * @param {string} [opts.errorText] pasted error text (--error / piped stdin)
 */
export async function runDiagnosis({ env = process.env, dshHome: dshHomeFlag, profile: profileFlag, offline = false, errorText = null } = {}) {
  const npmRoot = resolveNpmGlobalRoot(env)
  const install = detectDshInstall(npmRoot)
  const dshHome = resolveDshHome(dshHomeFlag, env)
  // Graph rows from the local shell install (the loader's third resolution
  // branch — row bundles register package-name factories). null when unreadable.
  const rows = collectShellRows(npmRoot)

  // --error / stdin mode: diagnose the objects the pasted error references,
  // never the whole profile (the plugin may not be installed here at all).
  if (typeof errorText === 'string' && errorText.trim()) {
    const refs = parseErrorText(errorText)
    if (refs.recognized) {
      const { doc: seeds, origin: seedsOrigin } = await loadShellSeeds({ offline, bundled: loadBundledSeeds() })
      const [observed, fixes] = await Promise.all([loadCompatObserved({ offline }), loadFixes({ offline })])
      const report = diagnoseErrorRefs({ refs, install, dshHome, seeds, seedsOrigin, observed, fixes, rows, offline })
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
        plugins: [],
        findings: [],
        summary: { errors: 0, warnings: 0, notes: 0, healthy: false },
        degraded: false,
      }
    }
    // bare "Failed to load plugins" with no refs → fall through to the full
    // diagnosis, flagged so the renderer can say why.
  }

  const availableProfiles = listProfiles(dshHome)
  const { profile } = selectProfile(availableProfiles, profileFlag, env)
  const profileData = readProfile(profile, join(dshHome, 'profiles', profile))

  const { doc: seeds, origin: seedsOrigin } = await loadShellSeeds({ offline, bundled: loadBundledSeeds() })
  const [observed, fixes] = await Promise.all([loadCompatObserved({ offline }), loadFixes({ offline })])

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
    fixes,
    latest,
    rows,
    offline,
  })

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
