/**
 * dsh-why web — the paste-a-red-screen diagnosis, browser-side and pure.
 *
 * This is the same rule base and the same renderer the CLI uses (lib/rules.mjs,
 * lib/report.mjs), driven by data a page can legitimately have:
 *
 *   - the shell module tables, published per shell version (lib/data snapshot,
 *     refreshed live from dsh-insights.com when reachable);
 *   - the client graph ROWS of the shell the user picks (shell-rows.json), so a
 *     require of a built-in row is classified exactly as the CLI classifies it;
 *   - the known-fix case base and the observed-compat matrix.
 *
 * What it does NOT have is the user's machine: no profile, no installed plugin
 * versions, no third-party graph rows. So this module never pretends to have
 * them — `knownPkgs` stays empty (a require of some OTHER plugin's package is
 * reported as unresolvable here, which is true for a machine that does not have
 * it) and profile-wide rules (R2/R3/R5/R6) have nothing to run on.
 *
 * @module dsh-why/web/diagnose
 */

import { knownPatterns, parseErrorText } from '../lib/errparse.mjs'
import { diagnoseErrorRefs, resolveSeedVersion } from '../lib/rules.mjs'
import { renderText } from '../lib/report.mjs'
import { compareVersions, rowIndex } from '../lib/scanner.mjs'

/**
 * Build the report shape the renderer expects for an error it cannot parse
 * (mirrors diagnose.mjs's honest-unknown path, minus the filesystem work).
 */
function unrecognizedReport({ text, lang, shellVersion, seeds, seedsOrigin, rows, rowsExact, fixes, fixesOrigin }) {
  const versionsSorted = Object.keys(seeds?.versions ?? {}).sort(compareVersions)
  const seedPick = resolveSeedVersion(shellVersion, versionsSorted)
  return {
    generatedAt: new Date().toISOString(),
    mode: 'online',
    unrecognizedError: String(text).trim().slice(0, 1000),
    dshHome: null,
    install: { dshVersion: null, shellVersion: shellVersion ?? seedPick.version, shellPkg: 'published roster' },
    profile: null,
    availableProfiles: [],
    seed: { version: seedPick.version, source: seedPick.source, origin: seedsOrigin, words: seedPick.version ? [...(seeds?.versions?.[seedPick.version] ?? [])] : null },
    rows: rows ? { exact: rowsExact !== false, immediate: [...rowIndex(rows).immediate].sort(), lazy: [...rowIndex(rows).lazy].sort() } : null,
    fixes: fixes?.modules ? { origin: fixesOrigin ?? 'upstream', modules: Object.keys(fixes.modules).length } : null,
    plugins: [],
    findings: [],
    summary: { errors: 0, warnings: 0, notes: 0, conditional: 0, unclassified: 0, healthy: false },
    degraded: false,
  }
}

/**
 * Diagnose a pasted dsh loader error, entirely client-side.
 *
 * @param {object} opts
 * @param {string} opts.text            pasted console / red-screen text
 * @param {'en'|'zh'} [opts.lang]
 * @param {string|null} [opts.shellVersion] the user's dsh (shell) version — the
 *        single most important input: it selects the module table + row roster
 * @param {object} [opts.seeds]         shell-seeds document (upstream or bundled)
 * @param {'upstream'|'bundled'} [opts.seedsOrigin]
 * @param {object|null} [opts.rows]     { immediate, lazy } client rows for that shell
 * @param {boolean} [opts.rowsExact]    false when the roster is a published superset
 * @param {object|null} [opts.fixes]    fixes.json document
 * @param {'upstream'|'bundled'} [opts.fixesOrigin]
 * @param {object|null} [opts.observed] compat-observed document
 * @param {string} [opts.toolVersion]   dsh-why version, for the report title
 * @returns {{ kind: 'report'|'bare'|'unrecognized'|'empty', text: string, report?: object }}
 */
export function diagnosePastedError({
  text,
  lang = 'en',
  shellVersion = null,
  seeds = null,
  seedsOrigin = 'bundled',
  rows = null,
  rowsExact = true,
  fixes = null,
  fixesOrigin = null,
  observed = null,
  toolVersion = '0.0.0',
}) {
  const raw = typeof text === 'string' ? text : ''
  if (!raw.trim()) return { kind: 'empty', text: '' }

  const refs = parseErrorText(raw)
  if (!refs.recognized) {
    // A bare red screen has no reference to work with, and unlike the CLI this
    // page cannot scan a profile — say exactly that instead of guessing.
    if (refs.bare) return { kind: 'bare', text: raw }
    const report = unrecognizedReport({ text: raw, lang, shellVersion, seeds, seedsOrigin, rows, rowsExact, fixes, fixesOrigin })
    return { kind: 'unrecognized', report, text: renderText(report, lang, toolVersion, { color: false }) }
  }

  const report = diagnoseErrorRefs({
    refs,
    install: {
      // No CLI version to claim: the page knows the shell build the user picked
      // (that is what carries the module table and the rows) and nothing else.
      cliVersion: null,
      shellVersion: shellVersion ?? null,
      shellPkg: '@deepseek-ai/dsh-web-frontend (published roster)',
    },
    dshHome: null,
    seeds,
    seedsOrigin,
    observed,
    fixes,
    fixesOrigin,
    rows,
    offline: false,
  })
  return { kind: 'report', report, text: renderText(report, lang, toolVersion, { color: false }) }
}

/** The pattern list, for the page's "what can this read?" hint. */
export { knownPatterns }
