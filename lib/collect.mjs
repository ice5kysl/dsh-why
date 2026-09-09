/**
 * dsh-why — read-only environment collection.
 *
 * Everything here is fail-soft: a missing/unreadable piece degrades to null
 * or an empty list instead of throwing. A diagnostic tool must never crash.
 * Nothing under the user's home is ever written to.
 *
 * What gets collected:
 *   - the global dsh install (@deepseek-ai/dsh CLI version + the shell's
 *     @deepseek-ai/dsh-web-frontend version, resolved from package.json files
 *     under the global npm root);
 *   - the DSH_HOME layout (DSH_HOME env or ~/.dsh) and the selected profile's
 *     plugin inventory, mirrored from the profile manifest seam that
 *     `dsh plugin add` operates on (dsh.profile.bundles + dependencies);
 *   - for every plugin carrying a client bundle (exports["./client"], else
 *     the conventional lib/client.js), the guard-aware require set from the
 *     on-disk bundle.
 *
 * @module dsh-why/collect
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { extractRequiresV2 } from './scanner.mjs'

/** The in-box bundles dsh profile templates install themselves. */
const INBOX_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
])

function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** DSH_HOME: explicit flag → DSH_HOME env (blank = unset, dsh semantics) → ~/.dsh. */
export function resolveDshHome(configured, env = process.env) {
  const fromEnv = env.DSH_HOME
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh'))
  return resolve(expandHomePath(selected))
}

/**
 * The global npm root. DSH_WHY_NPM_ROOT (tests/overrides) → `npm root -g`
 * (5s budget, npm may be slow or absent) → the posix heuristic
 * `<node>/../lib/node_modules`. Null when none pans out.
 */
export function resolveNpmGlobalRoot(env = process.env) {
  const override = env.DSH_WHY_NPM_ROOT
  if (override !== undefined && override.trim().length > 0) return resolve(expandHomePath(override.trim()))
  try {
    const out = execFileSync('npm', ['root', '-g'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    const root = String(out).trim()
    if (root) return root
  } catch { /* npm unavailable — fall through to the heuristic */ }
  try {
    const candidate = join(dirname(process.execPath), '..', 'lib', 'node_modules')
    if (existsSync(candidate)) return resolve(candidate)
  } catch { /* keep null */ }
  return null
}

function readPkgVersion(path) {
  const pkg = readJson(path)
  return typeof pkg?.version === 'string' && pkg.version ? pkg.version : null
}

/**
 * Locate the global dsh install under the npm root and read its versions.
 * `cliVersion` is @deepseek-ai/dsh itself; `shellVersion` is the
 * dsh-web-frontend build that bakes the client module table (hoisted or
 * nested under the CLI package), falling back to dsh-web-app and finally to
 * the CLI version — same release train in practice.
 */
export function detectDshInstall(npmRoot) {
  if (!npmRoot) return null
  const cliPkgPath = join(npmRoot, '@deepseek-ai', 'dsh', 'package.json')
  const cliVersion = readPkgVersion(cliPkgPath)
  if (!cliVersion) return null
  const shellCandidates = [
    ['@deepseek-ai/dsh-web-frontend', join(npmRoot, '@deepseek-ai', 'dsh-web-frontend', 'package.json')],
    ['@deepseek-ai/dsh-web-frontend', join(npmRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'package.json')],
    ['@deepseek-ai/dsh-web-app', join(npmRoot, '@deepseek-ai', 'dsh-web-app', 'package.json')],
    ['@deepseek-ai/dsh-web-app', join(npmRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'package.json')],
  ]
  let shellPkg = null
  let shellVersion = null
  for (const [pkg, path] of shellCandidates) {
    const version = readPkgVersion(path)
    if (version) { shellPkg = pkg; shellVersion = version; break }
  }
  return {
    root: npmRoot,
    cliVersion,
    shellVersion: shellVersion ?? cliVersion,
    shellPkg: shellPkg ?? '@deepseek-ai/dsh',
    shellVersionExact: shellVersion !== null,
  }
}

/** Profile directory names under <dshHome>/profiles that contain a manifest. */
export function listProfiles(dshHome) {
  const dir = join(dshHome, 'profiles')
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink())
      && !['node_modules', '.', '..'].includes(e.name)
      && !e.name.includes('/')
      && existsSync(join(dir, e.name, 'package.json')))
    .map((e) => e.name)
    .sort()
}

/**
 * Pick the profile to diagnose: explicit flag → DSH_WHY_PROFILE → `web` when
 * present → the only profile when unambiguous → `web` (reported missing by
 * the caller with the available list).
 */
export function selectProfile(available, configured, env = process.env) {
  const fromEnv = env.DSH_WHY_PROFILE
  const wanted = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : null)
  if (wanted) return { profile: wanted, explicit: true }
  if (available.includes('web')) return { profile: 'web', explicit: false }
  if (available.length === 1) return { profile: available[0], explicit: false }
  return { profile: 'web', explicit: false }
}

/** exports["./client"] as a package-relative path (string or conditions object; import ?? default). */
function clientEntryPath(pkgJson) {
  const client = pkgJson?.exports?.['./client']
  const rel = typeof client === 'string'
    ? client
    : client && typeof client === 'object'
      ? client.import ?? client.default ?? null
      : null
  if (typeof rel !== 'string' || rel === '') return null
  const norm = rel.replace(/^\.\//, '')
  return norm.startsWith('../') || norm.startsWith('/') ? null : norm
}

/**
 * Read one profile directory into a plugin inventory. Mirrors the
 * dsh-market / dsh-insights-kit manifest contract:
 *   - plugins are the manifest's direct dependencies (plus bundles-only rows),
 *     minus the in-box @deepseek-ai/dsh-{base,web-app,headless} baseline;
 *   - `enabled` follows dsh.profile.bundles (no bundles field = every dep
 *     loads, older profile shape);
 *   - the installed version and engines.dsh come from the package's own
 *     package.json under the profile's node_modules (null version while a
 *     dep is declared but not materialized);
 *   - each plugin's client bundle is located (exports["./client"], else
 *     lib/client.js) and its require set extracted with guard context.
 */
export function readProfile(profile, dir) {
  const empty = { profile, dir, manifestFound: false, baseline: 0, plugins: [] }
  const manifest = readJson(join(dir, 'package.json'))
  if (manifest === null) return empty

  const bundlesRaw = manifest.dsh?.profile?.bundles
  const bundles = Array.isArray(bundlesRaw)
    ? new Set(bundlesRaw.filter((name) => typeof name === 'string'))
    : null

  const deps = manifest.dependencies && typeof manifest.dependencies === 'object' && !Array.isArray(manifest.dependencies)
    ? Object.entries(manifest.dependencies)
    : []

  let baseline = 0
  for (const name of INBOX_BUNDLES) {
    if (bundles?.has(name) || deps.some(([dep]) => dep === name)) baseline += 1
  }

  const rowFor = (name, spec) => {
    const installDir = join(dir, 'node_modules', name)
    const pkg = readJson(join(installDir, 'package.json'))
    const version = typeof pkg?.version === 'string' && pkg.version ? pkg.version : null
    const enginesDsh = typeof pkg?.engines?.dsh === 'string' ? pkg.engines.dsh : null
    const isPlugin = pkg !== null && (pkg.dsh !== undefined || pkg.cordis !== undefined)
    let client = null
    if (pkg !== null) {
      const entry = clientEntryPath(pkg) ?? (existsSync(join(installDir, 'lib', 'client.js')) ? 'lib/client.js' : null)
      if (entry) {
        const bundlePath = join(installDir, entry)
        try {
          const text = readFileSync(bundlePath, 'utf8')
          const { requires, requiresV2 } = extractRequiresV2(text)
          client = { entry, requires, requiresV2 }
        } catch { /* declared but unreadable — treated as no client */ }
      }
    }
    return {
      name,
      spec,
      version,
      enginesDsh,
      plugin: isPlugin,
      enabled: bundles === null || bundles.has(name),
      client,
    }
  }

  const plugins = []
  const seen = new Set()
  for (const [name, spec] of deps) {
    if (INBOX_BUNDLES.has(name)) continue
    seen.add(name)
    plugins.push(rowFor(name, typeof spec === 'string' ? spec : ''))
  }
  if (bundles !== null) {
    for (const name of bundles) {
      if (INBOX_BUNDLES.has(name) || seen.has(name)) continue
      plugins.push(rowFor(name, ''))
    }
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return { profile, dir, manifestFound: true, baseline, plugins }
}
