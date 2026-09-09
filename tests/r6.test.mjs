/**
 * R6 profile-integrity tests: declared-but-missing (crash), disabled-and-gone
 * (stale manifest entry), half-uninstall leftovers (warning), and the pnpm
 * symlink trap — a healthy symlinked install must never be misflagged.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { readProfile } from '../lib/collect.mjs'
import { diagnose } from '../lib/rules.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SEEDS = JSON.parse(readFileSync(new URL('../lib/data/shell-seeds.json', import.meta.url), 'utf8'))

const INSTALL = {
  root: join(FIXTURES, 'npm-global'),
  cliVersion: '0.1.2-rc.1',
  shellVersion: '0.1.2-rc.1',
  shellPkg: '@deepseek-ai/dsh-web-frontend',
  shellVersionExact: true,
}

const profileData = readProfile('integrity', join(FIXTURES, 'dsh-home', 'profiles', 'integrity'))
const report = diagnose({
  install: INSTALL,
  dshHome: join(FIXTURES, 'dsh-home'),
  profileData,
  availableProfiles: ['integrity'],
  seeds: SEEDS,
  seedsOrigin: 'bundled',
  offline: true,
  now: new Date('2026-09-10T00:00:00Z'),
})
const r6 = report.findings.filter((f) => f.rule === 'R6')
const byName = Object.fromEntries(report.plugins.map((p) => [p.name, p]))

describe('R6 · profile integrity', () => {
  it('declared + enabled but missing from node_modules → crash-level', () => {
    const hit = r6.find((f) => f.plugin === 'fake-missing-plugin')
    assert.ok(hit)
    assert.equal(hit.severity, 'error')
    assert.equal(hit.enabled, true)
    assert.equal(report.summary.errors, 1)
    assert.equal(report.summary.healthy, false)
    assert.equal(byName['fake-missing-plugin'].materialized, false)
  })

  it('declared but disabled and files gone → warning (stale manifest entry), not a crash', () => {
    const hit = r6.find((f) => f.plugin === 'fake-disabled-gone')
    assert.ok(hit)
    assert.equal(hit.severity, 'warning')
    assert.equal(hit.enabled, false)
  })

  it('half-uninstall leftover: a plugin on disk declared nowhere → warning', () => {
    const hit = r6.find((f) => f.plugin === 'fake-leftover-plugin')
    assert.ok(hit)
    assert.equal(hit.severity, 'warning')
    assert.equal(hit.leftover, true)
    assert.deepEqual(profileData.leftovers, ['fake-leftover-plugin'])
  })

  it('pnpm trap: a symlinked direct dep into .pnpm resolves and is NOT flagged', () => {
    const row = byName['fake-healthy-plugin']
    assert.equal(row.materialized, true)
    assert.equal(row.version, '2.1.0')
    assert.equal(row.status, 'ok') // its requires still scan through the symlink
    assert.equal(r6.filter((f) => f.plugin === 'fake-healthy-plugin').length, 0)
  })

  it('existing fixture profiles stay R6-clean (no regression)', () => {
    for (const name of ['web', 'clean']) {
      const data = readProfile(name, join(FIXTURES, 'dsh-home', 'profiles', name))
      const r = diagnose({
        install: INSTALL, dshHome: join(FIXTURES, 'dsh-home'), profileData: data,
        availableProfiles: [name], seeds: SEEDS, offline: true,
      })
      assert.equal(r.findings.filter((f) => f.rule === 'R6').length, 0, `profile ${name} should have no R6 findings`)
    }
  })
})
