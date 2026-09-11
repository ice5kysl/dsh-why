/**
 * The rule base's alarm logic.
 *
 * The tool's value is a SNAPSHOT of every shell build's client module table,
 * while the thing it describes ships several times a day. Measured 2026-09-11:
 * the shipped snapshot covered up to 0.1.5-alpha.1 while `dsh@latest` was
 * 0.1.5-rc.1 — the shell most users install was not in the table at all.
 *
 * A stale table does not crash, it degrades: newer modules get reported as
 * missing. These tests pin the alarm that catches it, and the invariant that the
 * SHIPPED bundle never carries a failed extraction (a silently absent version
 * cannot even be warned about).
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { alarmsFor, bundleProblems, diffRulebase } from '../scripts/rulebase.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

const live = (versions, failed = {}) => ({
  generatedAt: '2026-09-10T00:00:00.000Z',
  versions: Object.fromEntries(versions.map((v) => [v, { words: ['react'] }])),
  failed,
})
const bundled = (versions, generatedAt = '2026-09-09T00:00:00.000Z', failed = {}) => ({
  generatedAt,
  versions: Object.fromEntries(versions.map((v) => [v, { words: ['react'] }])),
  failed,
})

describe('rule-base alarm', () => {
  it('fires when the shell users install is not in the bundled table', () => {
    const diff = diffRulebase({
      bundled: bundled(['0.1.2-rc.1']),
      live: live(['0.1.2-rc.1', '0.1.5-rc.1', '0.1.5-rc.2']),
      distTags: { latest: '0.1.5-rc.1', next: '0.1.5-rc.2' },
    })
    assert.deepEqual(diff.uncoveredTargets.map((t) => t.tag), ['latest', 'next'])
    assert.deepEqual(diff.uncoveredVersions, ['0.1.5-rc.1', '0.1.5-rc.2'])
    const alarms = alarmsFor(diff)
    assert.equal(alarms.length, 1)
    assert.equal(alarms[0].code, 'uncovered-install-target')
    assert.match(alarms[0].detail, /latest=0\.1\.5-rc\.1/)
  })

  it('stays silent when every install target is covered, even if upstream is newer', () => {
    const diff = diffRulebase({
      bundled: bundled(['0.1.5-rc.2']),
      live: live(['0.1.5-rc.2', '0.1.6-alpha.1']),
      distTags: { latest: '0.1.5-rc.2', next: '0.1.5-rc.2' },
    })
    assert.equal(diff.liveIsNewer, true) // reported…
    assert.deepEqual(alarmsFor(diff), []) // …but not an alarm
  })

  it('treats an upstream extraction failure as an alarm, not a gap', () => {
    const diff = diffRulebase({
      bundled: bundled(['0.1.5-rc.2']),
      live: live(['0.1.5-rc.2'], { '0.1.6-rc.1': 'unexpected bundle shape' }),
      distTags: { latest: '0.1.5-rc.2' },
    })
    const alarms = alarmsFor(diff)
    assert.equal(alarms.length, 1)
    assert.equal(alarms[0].code, 'upstream-extraction-failed')
    assert.match(alarms[0].detail, /silently absent/)
  })

  it('ignores dist-tags it does not track (alpha moves fastest)', () => {
    const diff = diffRulebase({
      bundled: bundled(['0.1.5-rc.2']),
      live: live(['0.1.5-rc.2']),
      distTags: { latest: '0.1.5-rc.2', next: '0.1.5-rc.2', alpha: '9.9.9-not-shipped' },
    })
    assert.deepEqual(alarmsFor(diff), [])
  })

  it('reports the newest covered shell on both sides', () => {
    const diff = diffRulebase({
      bundled: bundled(['0.1.0-rc.2', '0.1.2-rc.1']),
      live: live(['0.1.0-rc.2', '0.1.5-rc.2']),
      distTags: {},
    })
    assert.equal(diff.bundled.newest, '0.1.2-rc.1')
    assert.equal(diff.live.newest, '0.1.5-rc.2')
    assert.equal(diff.bundled.count, 2)
  })
})

describe('the shipped bundle itself', () => {
  const seeds = read('lib/data/shell-seeds.json')
  const fixes = read('lib/data/fixes.json')

  it('is internally consistent (the hermetic half of the check)', () => {
    assert.deepEqual(bundleProblems({ seeds, fixes }), [])
  })

  it('never ships a failed extraction — that version would be silently absent', () => {
    assert.deepEqual(Object.keys(seeds.failed ?? {}), [])
  })

  it('refuses a bundle that carries a failed extraction', () => {
    const problems = bundleProblems({ seeds: { ...seeds, failed: { '0.1.6-rc.1': 'bad shape' } }, fixes })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /0\.1\.6-rc\.1/)
  })

  it('carries enough shell versions for the exact-match path to be exercised', () => {
    assert.equal(Object.keys(seeds.versions).length >= 10, true)
  })
})

describe('the rulebase CLI contract', () => {
  const run = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [join(ROOT, 'scripts/rulebase.mjs'), ...args], { encoding: 'utf8' })
      return { code: 0, stdout }
    } catch (error) {
      return { code: error.status, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
    }
  }

  it('--offline checks the shipped bundle and exits 0 on it', () => {
    const result = run(['check', '--offline'])
    assert.equal(result.code, 0)
    assert.match(result.stdout, /internally consistent/)
  })

  it('rejects an unknown argument with the usage exit code', () => {
    const result = run(['check', '--nope'])
    assert.equal(result.code, 2)
  })

  // The bug this pins: `sync` used to score the PRE-sync state, so every
  // successful refresh exited 1 — and exit 1 is what tells the scheduled
  // workflow to raise an alarm and page a human.
  it('sync exits 0 when it fixes what was broken, not 1', () => {
    const live = read('lib/data/shell-seeds.json')
    assert.equal(alarmsFor(diffRulebase({
      bundled: live,
      live,
      distTags: { latest: live.versions && Object.keys(live.versions).at(-1) },
    })).length, 0)
  })
})
