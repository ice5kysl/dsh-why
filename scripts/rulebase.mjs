#!/usr/bin/env node
/**
 * dsh-why — keep the bundled rule base from rotting.
 *
 * The tool's entire value is "I know which modules each shell build provides".
 * That knowledge is a SNAPSHOT (`lib/data/shell-seeds.json`), while the thing it
 * describes ships several times a day. Measured on 2026-09-11: the snapshot
 * covered up to `0.1.5-alpha.1` while `dsh@latest` was `0.1.5-rc.1` and
 * `dsh@next` was `0.1.5-rc.2` — three shell versions behind, two of them the ones
 * users actually install.
 *
 * A stale snapshot does not crash. It degrades: dsh-why starts calling modules
 * "missing" that a newer shell provides. The CLI is honest about it (it prints
 * the `envSeedOlder` warning and online runs fetch the live table), but an
 * honest decay is still decay, and nothing was watching it.
 *
 *   node scripts/rulebase.mjs check    # compare the bundle against upstream
 *   node scripts/rulebase.mjs sync     # write the live data into lib/data/
 *
 * Exit codes: 0 = healthy · 1 = alarm (stale, or upstream extraction broke) ·
 * 2 = COULD NOT VERIFY (network/parse failure) — deliberately non-zero, because
 * "I could not check" must never look like "all good".
 *
 * @module dsh-why/scripts/rulebase
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compareVersions } from '../lib/scanner.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INSIGHTS = 'https://dsh-insights.com/data'

/** Files we track, and where each comes from. */
const SOURCES = [
  { file: 'lib/data/shell-seeds.json', url: `${INSIGHTS}/shell-seeds.json`, watch: 'versions' },
  { file: 'lib/data/fixes.json', url: `${INSIGHTS}/fixes.json`, watch: 'modules' },
]

/** The dist-tags whose version a user is most likely running. */
const TRACKED_TAGS = ['latest', 'next']

const newest = (versions) => (versions.length ? [...versions].sort(compareVersions).at(-1) : null)

/**
 * Compare the bundled rule base with upstream. Pure, so the alarm logic is
 * testable without a network.
 *
 * @param {{bundled: object, live: object, distTags: Record<string,string>}} input
 */
export function diffRulebase({ bundled, live, distTags = {} }) {
  const bundledVersions = Object.keys(bundled?.versions ?? {})
  const liveVersions = Object.keys(live?.versions ?? {})
  const covered = new Set(bundledVersions)

  // The frontend package's own dist-tags are NOT a usable signal (`latest` there
  // is an ancient 0.0.1-rc.5). What matters is the CLI a user installs, and its
  // version numbers track the shell's.
  const targets = TRACKED_TAGS
    .filter((tag) => distTags[tag])
    .map((tag) => ({ tag, version: distTags[tag], covered: covered.has(distTags[tag]) }))

  return {
    bundled: {
      generatedAt: bundled?.generatedAt ?? null,
      count: bundledVersions.length,
      newest: newest(bundledVersions),
    },
    live: {
      generatedAt: live?.generatedAt ?? null,
      count: liveVersions.length,
      newest: newest(liveVersions),
    },
    targets,
    uncoveredTargets: targets.filter((t) => !t.covered),
    uncoveredVersions: liveVersions.filter((v) => !covered.has(v)).sort(compareVersions),
    failedUpstream: Object.keys(live?.failed ?? {}),
    liveIsNewer: Boolean(bundled?.generatedAt && live?.generatedAt && live.generatedAt > bundled.generatedAt),
  }
}

/** Alarm conditions, kept separate from the diff so the reason is always explicit. */
export function alarmsFor(diff) {
  const alarms = []
  if (diff.uncoveredTargets.length) {
    alarms.push({
      code: 'uncovered-install-target',
      detail: `the shell users install is not in the bundled table: ${diff.uncoveredTargets.map((t) => `${t.tag}=${t.version}`).join(', ')}`,
    })
  }
  if (diff.failedUpstream.length) {
    alarms.push({
      code: 'upstream-extraction-failed',
      detail: `the extractor could not read ${diff.failedUpstream.length} shell build(s): ${diff.failedUpstream.join(', ')} — those versions are silently absent from the table`,
    })
  }
  return alarms
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
  return response.json()
}

/**
 * Hermetic invariants of the SHIPPED bundle — no network needed. A bundle that
 * ships a failed extraction is worse than a stale one: the version is silently
 * absent, so the tool cannot even warn about it.
 */
export function bundleProblems({ seeds, fixes }) {
  const problems = []
  if (!seeds) problems.push('lib/data/shell-seeds.json is missing or not valid JSON')
  else {
    const versions = Object.keys(seeds.versions ?? {})
    if (!versions.length) problems.push('shell-seeds.json has no versions')
    if (!seeds.generatedAt) problems.push('shell-seeds.json has no generatedAt')
    const failed = Object.keys(seeds.failed ?? {})
    if (failed.length) problems.push(`shell-seeds.json ships ${failed.length} failed extraction(s): ${failed.join(', ')}`)
  }
  if (!fixes) problems.push('lib/data/fixes.json is missing or not valid JSON')
  return problems
}

function readBundled(rel) {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) } catch { return null }
}

async function main() {
  const argv = process.argv.slice(2)
  const mode = argv.find((a) => a === 'check' || a === 'sync') ?? 'check'
  const json = argv.includes('--json')
  const offline = argv.includes('--offline')
  const unknown = argv.find((a) => !['check', 'sync', '--json', '--offline'].includes(a))
  if (unknown) {
    console.error(`unrecognized argument: ${unknown}`)
    process.exitCode = 2
    return
  }

  if (offline) {
    const problems = bundleProblems({
      seeds: readBundled('lib/data/shell-seeds.json'),
      fixes: readBundled('lib/data/fixes.json'),
    })
    if (json) console.log(JSON.stringify({ mode: 'offline', ok: !problems.length, problems }, null, 2))
    else if (problems.length) { console.error('rule base is internally broken:'); for (const p of problems) console.error(`  - ${p}`) }
    else console.log('rule base: internally consistent (freshness NOT checked — offline)')
    process.exitCode = problems.length ? 1 : 0
    return
  }

  let live, distTags, seedsLive, fixesLive
  try {
    ;[seedsLive, fixesLive, distTags] = await Promise.all([
      fetchJson(`${INSIGHTS}/shell-seeds.json`),
      fetchJson(`${INSIGHTS}/fixes.json`),
      fetchJson('https://registry.npmjs.org/-/package/@deepseek-ai%2Fdsh/dist-tags'),
    ])
    live = seedsLive
  } catch (error) {
    console.error(`COULD NOT VERIFY the rule base: ${error.message}`)
    console.error('Treating "could not check" as a failure, not as a pass.')
    process.exitCode = 2
    return
  }

  const bundled = readBundled('lib/data/shell-seeds.json')
  const diff = diffRulebase({ bundled, live, distTags })
  const alarms = alarmsFor(diff)

  if (mode === 'sync') {
    const changed = []
    for (const [source, incoming] of [[SOURCES[0], seedsLive], [SOURCES[1], fixesLive]]) {
      const current = readBundled(source.file)
      const next = `${JSON.stringify(incoming, null, 2)}\n`
      if (!current || JSON.stringify(current) !== JSON.stringify(incoming)) {
        writeFileSync(join(ROOT, source.file), next)
        changed.push(source.file)
      }
    }
    // Re-evaluate against what we just WROTE. Judging the sync by the pre-sync
    // state would make every successful refresh look like a failure — and the
    // alarm is exactly what tells a human to look.
    const after = diffRulebase({ bundled: readBundled(SOURCES[0].file), live: seedsLive, distTags })
    const remaining = alarmsFor(after)
    if (json) console.log(JSON.stringify({ mode: 'sync', changed, diff: after, alarms: remaining }, null, 2))
    else {
      console.log(changed.length ? `updated: ${changed.join(', ')}` : 'rule base already matches upstream')
      console.log(`  bundled newest shell: ${diff.bundled.newest} → ${after.bundled.newest}`)
      if (remaining.length) {
        console.log()
        console.log('ALARM — syncing did not fix this, a human is needed')
        for (const alarm of remaining) console.log(`  ✖ [${alarm.code}] ${alarm.detail}`)
      } else {
        console.log('✓ the bundled table now covers every install target')
      }
    }
    process.exitCode = remaining.length ? 1 : 0
    return
  }

  if (json) {
    console.log(JSON.stringify({ mode: 'check', ok: !alarms.length, diff, alarms }, null, 2))
  } else {
    console.log('rule base')
    console.log(`  bundled : ${diff.bundled.count} shell version(s), newest ${diff.bundled.newest} (built ${diff.bundled.generatedAt ?? '?'})`)
    console.log(`  upstream: ${diff.live.count} shell version(s), newest ${diff.live.newest} (built ${diff.live.generatedAt ?? '?'})`)
    console.log(`  install targets: ${diff.targets.map((t) => `${t.tag}=${t.version} ${t.covered ? '✓' : '✗ NOT COVERED'}`).join(' · ')}`)
    if (diff.uncoveredVersions.length) {
      console.log(`  published but uncovered: ${diff.uncoveredVersions.join(', ')}`)
    }
    console.log()
    if (alarms.length) {
      console.log('ALARM')
      for (const alarm of alarms) console.log(`  ✖ [${alarm.code}] ${alarm.detail}`)
      console.log()
      console.log('  Fix: node scripts/rulebase.mjs sync   (then re-run the tests)')
    } else {
      console.log('✓ rule base covers every install target and upstream extraction is clean')
    }
    if (diff.liveIsNewer && !alarms.length) console.log('  note: upstream is newer but nothing you install is uncovered — sync at your convenience')
  }

  process.exitCode = alarms.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`rulebase: internal error: ${error?.message ?? error}`)
    process.exitCode = 2
  })
}
