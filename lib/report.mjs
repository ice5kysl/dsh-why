/**
 * dsh-why — report rendering. Two faces of the same diagnosis object:
 * human text (bilingual, ANSI-colored only on a TTY) and --json passthrough
 * (the structured report plus the issue template). Also builds the
 * copy-ready GitHub issue template for crash-level findings.
 *
 * @module dsh-why/report
 */

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
 * Render one finding as text lines. R1 carries the symptom/cause/fix trio;
 * R2–R5 are single-block entries.
 */
function renderFinding(s, c, finding) {
  const icon = SEV_ICON[finding.severity] ?? '·'
  const sev = s.severity[finding.severity] ?? finding.severity
  const head = `${icon} [${sev}·${finding.rule}] `
  const lines = []
  if (finding.rule === 'R1' && finding.guardedMissing) {
    lines.push(c.dim(head + finding.plugin))
    lines.push(c.dim(`  ${s.r1Guarded(finding.guardedMissing.map((g) => g.spec))}`))
    return lines
  }
  if (finding.rule === 'R1') {
    lines.push(c.red(head + s.r1Title(finding.plugin)))
    lines.push(`  ${s.r1Symptom(finding.missing)}`)
    for (const spec of finding.missing) {
      const line = historyLine(s, spec, finding.history?.[spec])
      if (line) lines.push(`    - ${line}`)
    }
    const vt = verdictText(s, finding.observed)
    if (vt) lines.push(`  ${s.r1Observed(vt, finding.observed.repo)}`)
    if (finding.observed?.stale) lines.push(`  ${c.dim(s.r1ObservedStale(finding.observed.measuredVersion, finding.observed.installedVersion ?? '?'))}`)
    const counts = Object.entries(finding.ecosystemMissing ?? {})
    const max = counts.sort((a, b) => b[1] - a[1])[0]
    if (max && max[1] > 0) lines.push(`  ${s.r1Ecosystem(max[1])}`)
    lines.push(`  ${s.r1FixTitle}`)
    let n = 0
    const step = (text) => lines.push(`    ${++n}. ${text}`)
    if (finding.upgradeAvailable && finding.latest) step(s.r1FixUpgradePlugin(finding.plugin, finding.latest))
    const addedLater = finding.missing.find((spec) => {
      const h = finding.history?.[spec]
      return h?.kind === 'shipped' && !h.removedIn && h.since
    })
    const removed = finding.missing.find((spec) => finding.history?.[spec]?.removedIn)
    if (addedLater) step(s.r1FixUpgradeDsh(finding.history[addedLater].since))
    if (removed) step(s.r1FixDowngradeDsh(finding.history[removed].last))
    step(s.r1FixRemove(finding.plugin))
    step(s.r1FixIssue)
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
  // R5
  lines.push(c.dim(head + s.r5Title(finding.plugin)))
  lines.push(c.dim(`  ${s.r5Detail}`))
  return lines
}

/** Render the environment summary block. */
function renderEnvironment(s, c, report) {
  const lines = [`${s.envTitle}:`]
  if (!report.install) {
    lines.push(`  ${c.yellow(s.envNotFound)}`)
    lines.push(c.dim(`  ${s.envNotFoundHint}`))
  } else {
    lines.push(`  ${s.envDsh(report.install.dshVersion, report.install.shellVersion, report.install.shellPkg)}`)
  }
  lines.push(`  ${s.envHome(report.dshHome)}`)
  if (!report.profileFound) {
    lines.push(`  ${c.yellow(s.envProfileMissing(report.profile, report.availableProfiles))}`)
  } else {
    lines.push(`  ${s.envProfile(report.profile, report.pluginCount, report.enabledCount, report.baseline)}`)
  }
  if (report.seed) {
    const { version, source, origin } = report.seed
    if (source === 'exact') lines.push(`  ${s.envSeedExact(version, origin)}`)
    else if (source === 'approx-lower') lines.push(`  ${c.yellow(s.envSeedApprox(report.install?.shellVersion ?? '?', version, origin))}`)
    else if (source === 'snapshot-older') lines.push(`  ${c.yellow(s.envSeedOlder(report.install?.shellVersion ?? '?', version, origin))}`)
    else lines.push(`  ${c.yellow(s.envSeedUnavailable(report.install?.shellVersion ?? '?'))}`)
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
      env ? s.issueEnv(env.dshVersion, env.shellVersion, report.profile) : null,
      s.issuePlugin(f.plugin, plugin?.version),
      s.issueMissing(f.missing),
      s.issueError(f.missing[0]),
    ]
    for (const spec of f.missing) {
      const line = historyLine(s, spec, f.history?.[spec])
      if (line) lines.push(s.issueHistory(line))
    }
    lines.push('', s.issueAsk)
    return lines.filter((l) => l !== null).join('\n')
  })
  return blocks.join('\n\n---\n\n')
}

/** Render the full text report. */
export function renderText(report, lang, toolVersion, { color = false } = {}) {
  const s = t(lang)
  const c = makeColor(color)
  const lines = []
  lines.push(c.bold(s.title(toolVersion)))
  if (report.mode === 'offline') lines.push(c.dim(s.modeOffline))
  else if (report.degraded) lines.push(c.dim(s.modeOfflineFallback))
  lines.push('')
  lines.push(...renderEnvironment(s, c, report))
  lines.push('')

  const enabledRows = report.plugins.filter((p) => p.enabled)
  if (report.findings.length) {
    lines.push(`${s.findingsTitle}:`)
    for (const finding of report.findings) {
      lines.push(...renderFinding(s, c, finding))
    }
    lines.push('')
  }

  if (!report.install || !report.profileFound) {
    lines.push(c.dim(s.noInstallNoCheck))
  } else if (report.summary.healthy) {
    lines.push(c.green(`✓ ${s.greenTitle(enabledRows.length)}`))
    lines.push(c.dim(`  ${s.greenDetail}`))
  } else if (report.summary.errors > 0) {
    lines.push(c.red(`✗ ${s.redTitle(report.summary.errors)}`))
  } else {
    lines.push(c.yellow(`⚠ ${s.yellowTitle(report.summary.warnings)}`))
  }

  const issue = buildIssueTemplate(report, lang, toolVersion)
  if (issue) {
    lines.push('')
    lines.push(s.issueTitle)
    lines.push('```markdown')
    lines.push(issue)
    lines.push('```')
  }
  lines.push('')
  lines.push(c.dim(s.hintJson))
  return lines.join('\n')
}
