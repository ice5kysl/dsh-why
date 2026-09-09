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
  detectDshInstall,
  listProfiles,
  readProfile,
  resolveDshHome,
  resolveNpmGlobalRoot,
  selectProfile,
} from './collect.mjs'
import { fetchLatestVersions, loadCompatObserved, loadShellSeeds } from './net.mjs'
import { diagnose } from './rules.mjs'

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
 */
export async function runDiagnosis({ env = process.env, dshHome: dshHomeFlag, profile: profileFlag, offline = false } = {}) {
  const npmRoot = resolveNpmGlobalRoot(env)
  const install = detectDshInstall(npmRoot)
  const dshHome = resolveDshHome(dshHomeFlag, env)
  const availableProfiles = listProfiles(dshHome)
  const { profile } = selectProfile(availableProfiles, profileFlag, env)
  const profileData = readProfile(profile, join(dshHome, 'profiles', profile))

  const { doc: seeds, origin: seedsOrigin } = await loadShellSeeds({ offline, bundled: loadBundledSeeds() })
  const observed = await loadCompatObserved({ offline })

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
    latest,
    offline,
  })

  report.profileFound = profileData.manifestFound
  report.pluginCount = profileData.plugins.length
  report.enabledCount = profileData.plugins.filter((p) => p.enabled).length
  report.baseline = profileData.baseline
  // "degraded" = online was requested but the ecosystem matrix did not arrive;
  // the local rule base still produced a full diagnosis.
  report.degraded = !offline && observed === null
  return report
}
