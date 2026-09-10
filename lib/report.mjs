/**
 * dsh-why — report rendering. Two faces of the same diagnosis object:
 * human text (bilingual, ANSI-colored only on a TTY) and --json passthrough
 * (the structured report plus the issue template). Also builds the
 * copy-ready GitHub issue template for crash-level findings.
 *
 * @module dsh-why/report
 */

import { knownPatterns } from './errparse.mjs'
import { t } from './i18n.mjs'

function makeColor(enabled) {
  const wrap = (code) => (s) => (enabled ? `[${code}m${s}[0m` : s)
  return {
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    dim: wrap('2'),
    bold: wrap('1'),
  }
}

const SEV_ICON = { error: '✗', warning: '⚠', info: 'ℹ', note: '·' }

function historyLine(s, spec, h) {
  if (!h) return null
  if (h.kind === 'never') return `${spec}: ${s.histNever}`
  if (h.kind === 'shipped' && h.removedIn) return `${spec}: ${s.histRemoved(h.last, h.removedIn)}`
  // Missing now but shipped and never removed → the module only exists in
  // shells NEWER than the one checked: the user's dsh is too old.
  if (h.kind === 'shipped') return `${spec}: ${s.histAddedLater(h.since)}`
  return null
}

function verdictText(s, observed) {
  if (!observed?.verdict) return null
  const v = s.verdictText[observed.verdict]
  if (typeof v === 'function') return v(observed.since, observed.okUntil)
  return v ?? observed.verdict
}

/**
 * Pick the localized variant of a case-base string. The data's canonical source
 * is Chinese (`fix` / `cases[].note`); English is a parallel field (`fixEn` /
 * `noteEn`) that may lag or be absent — a missing translation shows the Chinese
 * text rather than nothing.
 */
export function pickLocalized(lang, zh, en) {
  return lang === 'en' && typeof en === 'string' && en.trim() ? en : zh
}

/**
 * The known-fix case-base block: recipe + real-world cases per module, in the
 * report's language. The title says so when the recipes came from the bundled
 * snapshot rather than the live site, so a reader never mistakes a stale recipe
 * for current guidance.
 */
function renderKnownFixes(s, finding, fixes, lang) {
  if (!finding.knownFixes) return []
  const entries = Object.entries(finding.knownFixes)
  if (!entries.length) return []
  const bundled = (finding.knownFixesOrigin ?? fixes?.origin) === 'bundled'
  const lines = [`  ${bundled ? s.r1KnownFixTitleBundled : s.r1KnownFixTitle}`]
  const multi = entries.length > 1
  for (const [spec, kf] of entries) {
    const prefix = multi ? `[${spec}] ` : ''
    const fix = pickLocalized(lang, kf.fix, kf.fixEn)
    if (fix) lines.push(`    ${prefix}${fix}`)
    for (const item of kf.cases) lines.push(`    ${s.r1KnownFixCase(item.repo, pickLocalized(lang, item.note, item.noteEn), item.url)}`)
  }
  return lines
}

/**
 * The one title for a finding, shared by the text renderer and the web's DOM
 * renderer so the two can never disagree about what a finding says. Rule-by-rule
 * it mirrors the CLI's wording; the R1 branch distinguishes profile mode (plugin
 * named), the pasted-error states (resolved / built-in graph row / unclassified
 * / missing), and the conditional flavor.
 */
export function findingTitle(finding, s) {
  switch (finding.rule) {
    case 'R1': {
      if (finding.reason && (finding.conditional?.length || finding.unknown?.length)) {
        return finding.conditional?.length ? s.r1CondTitle(finding.plugin) : s.r1UnknownTitle(finding.plugin)
      }
      const state = finding.resolvableNow
      if (!finding.fromError) return finding.plugin ? s.r1Title(finding.plugin) : s.r1TitleError
      if (finding.plugin && state === false) return s.r1Title(finding.plugin)
      return state === true ? s.r1TitleErrorResolved
        : state === 'conditional' ? s.r1TitleErrorConditional
          : state === 'unknown' ? s.r1TitleErrorUnknown
            : s.r1TitleError
    }
    case 'R2': return s.r2Title(finding.plugin)
    case 'R3': return s.r3Title(finding.plugin)
    case 'R5': return s.r5Title(finding.plugin)
    case 'R6': return finding.leftover ? s.r6LeftoverTitle(finding.plugin) : s.r6MissingTitle(finding.plugin)
    default: return finding.rule
  }
}

/**
 * The ordered fix steps for a finding, shared by both renderers. Empty for
 * states that carry no action list (resolved / a built-in graph row).
 */
export function findingFixSteps(finding, s) {
  if (finding.rule === 'R1') {
    const state = finding.resolvableNow
    if (state === 'unknown') return [s.r1UnknownFix]
    if (state === false || state === undefined) {
      const steps = []
      if (finding.upgradeAvailable && finding.latest) steps.push(s.r1FixUpgradePlugin(finding.plugin, finding.latest))
      const addedLater = finding.missing.find((spec) => {
        const h = finding.history?.[spec]
        return h?.kind === 'shipped' && !h.removedIn && h.since
      })
      const removed = finding.missing.find((spec) => finding.history?.[spec]?.removedIn)
      if (addedLater) steps.push(s.r1FixUpgradeDsh(finding.history[addedLater].since))
      if (removed) steps.push(s.r1FixDowngradeDsh(finding.history[removed].last))
      if (finding.plugin) steps.push(s.r1FixRemove(finding.plugin))
      steps.push(s.r1FixIssue)
      return steps
    }
    return []
  }
  if (finding.rule === 'R6' && !finding.leftover) return [s.r6MissingFixReinstall(finding.plugin), s.r6MissingFixRemove(finding.plugin)]
  if (finding.rule === 'R2' && !finding.undecidable) return [s.r2Fix(finding.plugin)]
  return []
}

/**
 * Render one finding as text lines. R1 carries the symptom/cause/fix trio;
 * R2–R5 are single-block entries.
 */
function renderFinding(s, c, finding, fixes = null, lang = 'en') {
  const icon = SEV_ICON[finding.severity] ?? '·'
  const sev = s.severity[finding.severity] ?? finding.severity
  const head = `${icon} [${sev}·${finding.rule}] `
  const lines = []
  if (finding.rule === 'R1' && finding.guardedMissing) {
    lines.push(c.dim(head + finding.plugin))
    lines.push(c.dim(`  ${s.r1Guarded(finding.guardedMissing.map((g) => g.spec))}`))
    return lines
  }
  // Profile-mode conditional / unclassifiable: these always carry a plugin name
  // and the conditional/unknown arrays. (--error findings also set `reason` but
  // carry `missing` + `resolvableNow` instead — they fall through to the branch
  // below, which is shaped for them.)
  if (finding.rule === 'R1' && finding.reason && (finding.conditional?.length || finding.unknown?.length)) {
    const conditional = finding.conditional ?? []
    const unknown = finding.unknown ?? []
    lines.push(c.yellow(head + (conditional.length ? s.r1CondTitle(finding.plugin) : s.r1UnknownTitle(finding.plugin))))
    if (conditional.length) {
      lines.push(`  ${s.r1CondDetail(conditional)}`)
      lines.push(`  ${s.r1CondFix}`)
      lines.push(...renderKnownFixes(s, finding, fixes, lang))
    }
    if (unknown.length) {
      lines.push(`  ${s.r1UnknownDetail(unknown)}`)
      for (const spec of unknown) {
        const line = historyLine(s, spec, finding.history?.[spec])
        if (line) lines.push(`    - ${line}`)
      }
      lines.push(`  ${s.r1UnknownFix}`)
    }
    return lines
  }
  if (finding.rule === 'R1') {
    // state === true | 'conditional' | 'unknown' for --error refs; false for a
    // confirmed crash; undefined for a profile-mode crash. Each state gets a
    // title that does not overclaim, and only the crash / unverified classes
    // carry a fix list (a graph-row module needs no "downgrade dsh").
    const state = finding.resolvableNow
    const paint = finding.severity === 'error' ? c.red : c.yellow
    const title = findingTitle(finding, s)
    lines.push(paint(head + title))
    if (state === 'unknown') lines.push(`  ${s.r1SymptomUnverified(finding.missing)}`)
    else if (state === false || state === undefined) lines.push(`  ${s.r1Symptom(finding.missing)}`)
    for (const spec of finding.missing) {
      const line = historyLine(s, spec, finding.history?.[spec])
      if (line) lines.push(`    - ${line}`)
    }
    if (state === true) lines.push(`  ${s.r1NowResolved}`)
    else if (state === 'conditional') lines.push(`  ${s.r1NowConditional}`)
    else if (state === 'unknown') lines.push(`  ${s.r1NowUnknown}`)
    const vt = verdictText(s, finding.observed)
    if (vt) lines.push(`  ${s.r1Observed(vt, finding.observed.repo)}`)
    if (finding.observed?.stale) lines.push(`  ${c.dim(s.r1ObservedStale(finding.observed.measuredVersion, finding.observed.installedVersion ?? '?'))}`)
    const counts = Object.entries(finding.ecosystemMissing ?? {})
    const max = counts.sort((a, b) => b[1] - a[1])[0]
    if (max && max[1] > 0) lines.push(`  ${s.r1Ecosystem(max[1])}`)
    if (state === 'unknown') {
      lines.push(`  ${s.r1NextStepTitle}`)
      let i = 0
      for (const step of findingFixSteps(finding, s)) lines.push(`    ${++i}. ${step}`)
    } else if (state === false || state === undefined) {
      lines.push(`  ${s.r1FixTitle}`)
      let i = 0
      for (const step of findingFixSteps(finding, s)) lines.push(`    ${++i}. ${step}`)
    }
    if (state !== true) lines.push(...renderKnownFixes(s, finding, fixes, lang))
    return lines
  }
  if (finding.rule === 'R2') {
    lines.push(c.yellow(head + s.r2Title(finding.plugin)))
    lines.push(`  ${finding.undecidable ? s.r2Undecidable(finding.enginesDsh) : s.r2Detail(finding.enginesDsh, finding.dshVersion)}`)
    if (!finding.undecidable) lines.push(`  ${s.r2Fix(finding.plugin)}`)
    return lines
  }
  if (finding.rule === 'R3') {
    lines.push(head + s.r3Title(finding.plugin))
    lines.push(`  ${s.r3Detail(finding.installed ?? '?', finding.latest)}`)
    return lines
  }
  if (finding.rule === 'R4' && finding.fromError) {
    lines.push(head + s.r4ErrorTitle(finding.plugin))
    const vt = verdictText(s, finding.observed)
    if (vt) lines.push(`  ${s.r1Observed(vt, finding.observed.repo)}`)
    if (finding.observed?.atShell?.status === 'broken') lines.push(`  ${s.r4AtShellBroken(finding.observed.atShell.missing ?? [])}`)
    if (finding.observed?.atShell?.status === 'conditional') lines.push(`  ${s.r4AtShellConditional}`)
    if (finding.observed?.atShell?.status === 'ok') lines.push(`  ${s.r4AtShellOk}`)
    return lines
  }
  if (finding.rule === 'R6') {
    if (finding.leftover) {
      lines.push(c.yellow(head + s.r6LeftoverTitle(finding.plugin)))
      lines.push(`  ${s.r6LeftoverDetail}`)
    } else if (finding.enabled === false) {
      lines.push(c.yellow(head + s.r6DisabledMissing(finding.plugin)))
    } else {
      lines.push(c.red(head + s.r6MissingTitle(finding.plugin)))
      lines.push(`  ${s.r6MissingDetail}`)
      lines.push(`  1. ${s.r6MissingFixReinstall(finding.plugin)}`)
      lines.push(`  2. ${s.r6MissingFixRemove(finding.plugin)}`)
    }
    return lines
  }
  // R5
  lines.push(c.dim(head + s.r5Title(finding.plugin)))
  lines.push(c.dim(`  ${s.r5Detail}`))
  return lines
}

/** Render the environment summary block. */
function renderEnvironment(s, c, report, opts = {}) {
  const lines = [`${s.envTitle}:`]
  if (!report.install) {
    lines.push(`  ${c.yellow(s.envNotFound)}`)
    lines.push(c.dim(`  ${s.envNotFoundHint}`))
  } else {
    lines.push(`  ${s.envDsh(report.install.dshVersion, report.install.shellVersion, report.install.shellPkg)}`)
  }
  // Error mode never scanned a profile — the profile line is meaningless there.
  if (!report.errorRefs && !report.unrecognizedError) {
    if (report.packageMode) {
      if (!report.profileFound) lines.push(`  ${c.yellow(s.envPackageMissing(report.profile))}`)
      else {
        const pkg = report.plugins[0]
        lines.push(`  ${s.envPackage(report.profile, pkg?.version ?? null, pkg?.hasClient ? true : false)}`)
      }
    } else {
      lines.push(`  ${s.envHome(report.dshHome)}`)
      if (!report.profileFound) {
        lines.push(`  ${c.yellow(s.envProfileMissing(report.profile, report.availableProfiles))}`)
      } else {
        lines.push(`  ${s.envProfile(report.profile, report.pluginCount, report.enabledCount, report.baseline)}`)
      }
    }
  }
  if (report.seed) {
    const { version, source, origin } = report.seed
    if (source === 'exact') lines.push(`  ${s.envSeedExact(version, origin)}`)
    else if (source === 'approx-lower') lines.push(`  ${c.yellow(s.envSeedApprox(report.install?.shellVersion ?? '?', version, origin))}`)
    else if (source === 'snapshot-older') lines.push(`  ${c.yellow(s.envSeedOlder(report.install?.shellVersion ?? '?', version, origin))}`)
    else lines.push(`  ${c.yellow(s.envSeedUnavailable(report.install?.shellVersion ?? '?'))}`)
  }
  // The row model is what keeps in-box graph rows out of the crash class, so
  // which flavor of it ran is part of the answer, not a debug detail. A caller
  // that got its rows somewhere other than a local install (the web page reads
  // the published per-shell roster) supplies its own truthful line.
  if (report.install && report.seed?.version) {
    if (opts.rowsNote) lines.push(`  ${c.dim(opts.rowsNote)}`)
    else if (!report.rows) lines.push(`  ${c.yellow(s.envRowsUnavailable)}`)
    else if (report.rows.exact === false) lines.push(`  ${c.dim(s.envRowsScanOnly(report.rows.immediate.length + report.rows.lazy.length))}`)
    else lines.push(`  ${c.dim(s.envRowsExact(report.rows.immediate.length, report.rows.lazy.length))}`)
  }
  return lines
}

/** Build the copy-ready issue markdown for crash-level findings (one block per broken plugin). */
export function buildIssueTemplate(report, lang, toolVersion) {
  const s = t(lang)
  const broken = report.findings.filter((f) => f.rule === 'R1' && f.severity === 'error')
  if (!broken.length) return null
  const env = report.install
  const blocks = broken.map((f) => {
    const plugin = report.plugins.find((p) => p.name === f.plugin)
    const lines = [
      s.issueHeading,
      '',
      s.issueTool(toolVersion),
      env ? s.issueEnv(env.dshVersion, env.shellVersion, report.profile ?? '?') : null,
      f.plugin ? s.issuePlugin(f.plugin, plugin?.version) : null,
      s.issueMissing(f.missing),
      s.issueError(f.missing[0]),
    ]
    for (const spec of f.missing) {
      const line = historyLine(s, spec, f.history?.[spec])
      if (line) lines.push(s.issueHistory(line))
      const knownFix = pickLocalized(lang, f.knownFixes?.[spec]?.fix, f.knownFixes?.[spec]?.fixEn)
      if (knownFix) lines.push(s.issueFix(knownFix))
    }
    lines.push('', s.issueAsk)
    return lines.filter((l) => l !== null).join('\n')
  })
  return blocks.join('\n\n---\n\n')
}

/**
 * Build the paste-to-an-AI-agent fix prompt: environment + findings + known
 * fixes + the seed-safe constraints (the client bundle may only require
 * modules in the current shell's table, everything else needs try/catch).
 * Null when there is nothing actionable.
 */
export function buildFixPrompt(report, lang, toolVersion) {
  const s = t(lang)
  const actionable = report.findings.filter((f) => f.severity === 'error' || f.severity === 'warning')
  if (!actionable.length) return null
  const lines = [s.promptHeader, '']
  if (report.install) lines.push(s.issueEnv(report.install.dshVersion, report.install.shellVersion, report.profile ?? '?'))
  lines.push(s.issueTool(toolVersion), '', s.promptFindingsLabel)
  for (const f of actionable) {
    if (f.rule === 'R1' && f.reason) {
      if (f.conditional?.length) {
        lines.push(`- ${f.plugin}: conditional require(s): ${f.conditional.map((m) => `\`${m}\``).join(', ')} — built-in graph rows; declare them in dsh.client.external (or inject) so the loader arrives them before the plugin materializes`)
      }
      if (f.unknown?.length) {
        lines.push(`- ${f.plugin}: UNCLASSIFIED require(s): ${f.unknown.map((m) => `\`${m}\``).join(', ')} — the shell's graph rows could not be read, so these are neither confirmed nor denied; do not change code on this evidence alone (re-run dsh-why with DSH_WHY_NPM_ROOT=<global npm root> first)`)
        for (const spec of f.unknown) {
          const line = historyLine(s, spec, f.history?.[spec])
          if (line) lines.push(`  - ${line}`)
        }
      }
      // --error mode carries the same two flavors, keyed off the pasted ref.
      if (f.fromError && f.reason === 'row-model-unavailable') {
        lines.push(`- UNCLASSIFIED module from the pasted error: ${f.missing.map((m) => `\`${m}\``).join(', ')} — this shell's graph rows could not be read, so whether it still resolves here is unverified; settle that before changing any code (re-run dsh-why with DSH_WHY_NPM_ROOT=<global npm root>)`)
      }
      if (f.fromError && f.reason === 'module-is-graph-row') {
        lines.push(`- ${f.missing.map((m) => `\`${m}\``).join(', ')} is a built-in graph ROW of the current shell (timing-dependent, not a hard incompatibility) — the pasted error is likely from an older build or an unlucky boot order`)
      }
    } else if (f.rule === 'R1' && f.missing) {
      lines.push(`- ${f.plugin ? `${f.plugin}: ` : ''}require() missed the module table: ${f.missing.map((m) => `\`${m}\``).join(', ')}`)
      for (const spec of f.missing) {
        const line = historyLine(s, spec, f.history?.[spec])
        if (line) lines.push(`  - ${line}`)
      }
      const vt = verdictText(s, f.observed)
      if (vt) lines.push(`  - observed matrix: ${vt}${f.observed.repo ? ` (${f.observed.repo})` : ''}`)
    } else if (f.rule === 'R6') {
      lines.push(`- ${f.leftover ? s.r6LeftoverTitle(f.plugin) : s.r6MissingTitle(f.plugin)}`)
    } else if (f.rule === 'R2') {
      lines.push(`- ${s.r2Title(f.plugin)} (engines.dsh "${f.enginesDsh}" vs dsh ${f.dshVersion})`)
    } else if (f.rule === 'R4' && f.fromError) {
      lines.push(`- ${s.r4ErrorTitle(f.plugin)}: ${verdictText(s, f.observed) ?? f.observed?.verdict ?? '?'}`)
    }
  }
  const fixLines = []
  for (const f of report.findings) {
    if (!f.knownFixes) continue
    for (const [spec, kf] of Object.entries(f.knownFixes)) {
      const fix = pickLocalized(lang, kf.fix, kf.fixEn)
      if (fix) fixLines.push(`- [\`${spec}\`] ${fix}`)
      for (const item of kf.cases) {
        const note = pickLocalized(lang, item.note, item.noteEn)
        fixLines.push(`  - case: ${item.repo}${note ? ` — ${note}` : ''}${item.url ? ` (${item.url})` : ''}`)
      }
    }
  }
  if (fixLines.length) lines.push('', report.fixes?.origin === 'bundled' ? s.promptFixesLabelBundled : s.promptFixesLabel, ...fixLines)
  lines.push('', s.promptConstraintsLabel)
  if (report.seed?.version && report.seed?.words?.length) lines.push(s.promptConstraintSeedSafe(report.seed.version, report.seed.words))
  lines.push(s.promptConstraintScope, s.promptConstraintVerify)
  return lines.join('\n')
}

/** Render the full text report. */
export function renderText(report, lang, toolVersion, { color = false, showPrompt = false, rowsNote = null, hint = true } = {}) {
  const s = t(lang)
  const c = makeColor(color)
  const lines = []
  lines.push(c.bold(s.title(toolVersion)))
  if (report.mode === 'offline') lines.push(c.dim(s.modeOffline))
  else if (report.degraded) lines.push(c.dim(s.modeOfflineFallback))
  lines.push('')
  lines.push(...renderEnvironment(s, c, report, { rowsNote }))

  // --error / stdin: what the parser pulled out of the pasted text.
  if (report.errorRefs && (report.errorRefs.plugins.length || report.errorRefs.modules.length)) {
    lines.push('')
    lines.push(`${s.errTitle}:`)
    if (report.errorRefs.plugins.length) lines.push(`  ${s.errPlugins(report.errorRefs.plugins)}`)
    if (report.errorRefs.modules.length) lines.push(`  ${s.errModules(report.errorRefs.modules)}`)
    lines.push(c.dim(`  ${s.errNotInstalledNote}`))
  }
  if (report.bareErrorFallback) {
    lines.push('')
    lines.push(c.dim(s.errBareFallback))
  }

  // Unrecognized pasted error: honest answer + the known patterns + where to send it.
  if (report.unrecognizedError) {
    lines.push('')
    lines.push(c.yellow(s.errUnknown))
    lines.push('')
    lines.push(`  ${s.errUnknownPatterns}`)
    for (const p of knownPatterns()) lines.push(`    - ${p}`)
    lines.push('')
    lines.push(`  ${s.errUnknownAdvice}`)
    lines.push(`  ${s.errUnknownCta}`)
    lines.push('')
    lines.push(c.dim(s.hintJson))
    return lines.join('\n')
  }
  lines.push('')

  const enabledRows = report.plugins.filter((p) => p.enabled)
  if (report.findings.length) {
    lines.push(`${s.findingsTitle}:`)
    for (const finding of report.findings) {
      lines.push(...renderFinding(s, c, finding, report.fixes, lang))
    }
    lines.push('')
  }

  if (report.errorRefs) {
    // Error mode: a red summary when the refs crash here, an honest note otherwise.
    if (report.summary.errors > 0) lines.push(c.red(`✗ ${s.redTitle(report.summary.errors)}`))
    else lines.push(c.yellow(`⚠ ${s.errNoCrash}`))
  } else if (!report.install || !report.profileFound) {
    lines.push(c.dim(s.noInstallNoCheck))
  } else if (report.summary.healthy) {
    lines.push(c.green(`✓ ${s.greenTitle(enabledRows.length)}`))
    lines.push(c.dim(`  ${s.greenDetail}`))
  } else if (report.summary.errors > 0) {
    lines.push(c.red(`✗ ${s.redTitle(report.summary.errors)}`))
  } else {
    // Split the warning tail so "risky but real" and "could not be decided"
    // are not read as the same thing (and so CI can key off the JSON counters).
    const extra = []
    if (report.summary.conditional) extra.push(s.summaryConditional(report.summary.conditional))
    if (report.summary.unclassified) extra.push(s.summaryUnclassified(report.summary.unclassified))
    lines.push(c.yellow(`⚠ ${s.yellowTitle(report.summary.warnings)}${extra.length ? ` — ${extra.join('; ')}` : ''}`))
  }

  const issue = buildIssueTemplate(report, lang, toolVersion)
  if (issue) {
    lines.push('')
    lines.push(s.issueTitle)
    lines.push('```markdown')
    lines.push(issue)
    lines.push('```')
  }
  if (showPrompt) {
    const prompt = buildFixPrompt(report, lang, toolVersion)
    lines.push('')
    if (prompt) {
      lines.push(s.promptTitle)
      lines.push('```markdown')
      lines.push(prompt)
      lines.push('```')
    } else {
      lines.push(c.dim(s.promptNone))
    }
  }
  if (hint) {
    lines.push('')
    lines.push(c.dim(s.hintJson))
  }
  return lines.join('\n')
}
