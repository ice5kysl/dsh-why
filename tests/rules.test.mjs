/**
 * Rule-base tests: diagnose() over the fixture profiles — crash/guarded/
 * healthy/disabled plugin classes, module history derived from the real
 * bundled seed snapshot, R2–R5 behaviors with injected data (no network).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { readProfile } from '../lib/collect.mjs'
import { buildIssueTemplate, renderText } from '../lib/report.mjs'
import { countEcosystemMissing, diagnose, moduleHistory, resolveSeedVersion } from '../lib/rules.mjs'
import { compareVersions } from '../lib/scanner.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SEEDS = JSON.parse(readFileSync(new URL('../lib/data/shell-seeds.json', import.meta.url), 'utf8'))

const INSTALL = {
  root: join(FIXTURES, 'npm-global'),
  cliVersion: '0.1.2-rc.1',
  shellVersion: '0.1.2-rc.1',
  shellPkg: '@deepseek-ai/dsh-web-frontend',
  shellVersionExact: true,
}

function runFixture(profileName, extra = {}) {
  const profileData = readProfile(profileName, join(FIXTURES, 'dsh-home', 'profiles', profileName))
  assert.equal(profileData.manifestFound, true)
  return diagnose({
    install: INSTALL,
    dshHome: join(FIXTURES, 'dsh-home'),
    profileData,
    availableProfiles: ['clean', 'web'],
    seeds: SEEDS,
    seedsOrigin: 'bundled',
    offline: true,
    now: new Date('2026-09-10T00:00:00Z'),
    ...extra,
  })
}

const byName = (report) => Object.fromEntries(report.plugins.map((p) => [p.name, p]))
const findingsFor = (report, rule) => report.findings.filter((f) => f.rule === rule)

describe('diagnose · broken fixture profile (web)', () => {
  const report = runFixture('web')

  it('environment summary fields', () => {
    assert.equal(report.install.dshVersion, '0.1.2-rc.1')
    assert.deepEqual(report.seed, { version: '0.1.2-rc.1', source: 'exact', origin: 'bundled' })
    assert.equal(report.mode, 'offline')
  })

  it('R1: unguarded require of a never-shipped module → crash-level finding', () => {
    const rows = byName(report)
    assert.equal(rows['fake-crash-plugin'].status, 'broken')
    assert.deepEqual(rows['fake-crash-plugin'].missing, ['@deepseek-ai/dsh-client-runtime/client'])
    assert.equal(rows['fake-crash-plugin'].history['@deepseek-ai/dsh-client-runtime/client'].kind, 'never')

    const r1 = findingsFor(report, 'R1')
    assert.equal(r1.length, 2) // the crash finding + the guarded-note for fake-guarded-plugin
    const r1err = r1.filter((f) => f.severity === 'error')
    assert.equal(r1err.length, 1)
    assert.equal(r1err[0].plugin, 'fake-crash-plugin')
    assert.deepEqual(r1err[0].missing, ['@deepseek-ai/dsh-client-runtime/client'])
    assert.equal(report.summary.errors, 1)
    assert.equal(report.summary.healthy, false)
  })

  it('guard-aware: try/catch-covered missing require does NOT crash (no R1 for the guarded plugin)', () => {
    const rows = byName(report)
    assert.equal(rows['fake-guarded-plugin'].status, 'ok')
    assert.deepEqual(rows['fake-guarded-plugin'].missing, [])
    assert.deepEqual(rows['fake-guarded-plugin'].guardedMissing, [
      { spec: '@deepseek-ai/dsh-client-runtime/client', guard: 'in-try' },
    ])
    const crashFindings = findingsFor(report, 'R1').filter((f) => f.plugin === 'fake-guarded-plugin' && f.severity === 'error')
    assert.equal(crashFindings.length, 0)
    // …but the guarded miss IS surfaced as a neutral note
    const guardedNote = findingsFor(report, 'R1').find((f) => f.plugin === 'fake-guarded-plugin' && f.severity === 'note')
    assert.deepEqual(guardedNote.guardedMissing, [{ spec: '@deepseek-ai/dsh-client-runtime/client', guard: 'in-try' }])
  })

  it('R2: engines.dsh ">=0.9.0" does not cover dsh 0.1.2-rc.1 → warning', () => {
    const r2 = findingsFor(report, 'R2')
    assert.equal(r2.length, 1)
    assert.equal(r2[0].severity, 'warning')
    assert.equal(r2[0].plugin, 'fake-guarded-plugin')
    assert.equal(r2[0].enginesDsh, '>=0.9.0')
    assert.equal(report.summary.warnings, 1)
  })

  it('healthy plugin: all requires resolve, engines range covers, no findings', () => {
    const rows = byName(report)
    assert.equal(rows['fake-healthy-plugin'].status, 'ok')
    assert.deepEqual(rows['fake-healthy-plugin'].requires, ['react', 'react/jsx-runtime']) // template-string require excluded
    assert.equal(report.findings.filter((f) => f.plugin === 'fake-healthy-plugin').length, 0)
  })

  it('offline mode: no R3/R4/R5 engagement at all', () => {
    assert.deepEqual(findingsFor(report, 'R3'), [])
    assert.deepEqual(findingsFor(report, 'R5'), [])
    assert.equal(byName(report)['fake-crash-plugin'].observed, null)
  })
})

describe('diagnose · clean fixture profile (green summary)', () => {
  const report = runFixture('clean')

  it('no findings, healthy summary', () => {
    assert.deepEqual(report.findings, [])
    assert.equal(report.summary.healthy, true)
    assert.equal(byName(report)['fake-healthy-plugin'].status, 'ok')
  })

  it('a plugin kept out of dsh.profile.bundles is disabled — never diagnosed as broken', () => {
    assert.equal(byName(report)['fake-crash-plugin'].status, 'disabled')
  })
})

describe('R3/R4/R5 with injected online data', () => {
  const observed = {
    plugins: {
      'fake-crash-plugin': {
        repo: 'example/fake-crash-plugin',
        version: '1.0.0',
        requires: ['@deepseek-ai/dsh-client-runtime/client', 'react'],
        results: { '0.1.2-rc.1': { status: 'broken', missing: ['@deepseek-ai/dsh-client-runtime/client'] } },
        verdict: { cls: 'never', total: 15 },
      },
      'other-broken-plugin': {
        repo: 'example/other',
        version: '3.1.0',
        requires: ['@deepseek-ai/dsh-client-runtime/client'],
        results: { '0.1.2-rc.1': { status: 'broken', missing: ['@deepseek-ai/dsh-client-runtime/client'] } },
        verdict: { cls: 'never', total: 15 },
      },
      'fake-healthy-plugin': {
        repo: 'example/fake-healthy-plugin',
        version: '2.0.0', // older than the installed 2.1.0 → stale
        requires: ['react'],
        results: { '0.1.2-rc.1': { status: 'ok' } },
        verdict: { cls: 'ok', total: 15 },
      },
    },
  }
  const latest = new Map([
    ['fake-crash-plugin', '1.1.0'],
    ['fake-guarded-plugin', '0.3.0'],
    ['fake-healthy-plugin', '2.2.0'],
  ])
  const report = runFixture('web', { observed, latest, offline: false })

  it('R3: npm latest > installed → info finding; equal versions stay quiet', () => {
    const r3 = findingsFor(report, 'R3')
    const byPlugin = Object.fromEntries(r3.map((f) => [f.plugin, f]))
    assert.equal(byPlugin['fake-crash-plugin'].latest, '1.1.0')
    assert.equal(byPlugin['fake-healthy-plugin'].latest, '2.2.0')
    assert.equal(byPlugin['fake-guarded-plugin'], undefined)
  })

  it('R1 finding carries the upgrade hint and the ecosystem verdict', () => {
    const [r1] = findingsFor(report, 'R1')
    assert.equal(r1.upgradeAvailable, true)
    assert.equal(r1.latest, '1.1.0')
    assert.equal(r1.observed.verdict, 'never')
    assert.equal(r1.observed.repo, 'example/fake-crash-plugin')
    assert.equal(r1.observed.stale, false)
    assert.equal(r1.observed.atShell.status, 'broken')
  })

  it('R4: same-missing-module ecosystem count ("you are not alone")', () => {
    const [r1] = findingsFor(report, 'R1')
    assert.equal(r1.ecosystemMissing['@deepseek-ai/dsh-client-runtime/client'], 2)
    assert.equal(countEcosystemMissing(observed, '@deepseek-ai/dsh-client-runtime/client'), 2)
  })

  it('R4: matrix version ≠ installed version → stale flag', () => {
    assert.equal(byName(report)['fake-healthy-plugin'].observed.stale, true)
  })

  it('R5: a client-carrying plugin absent from the matrix → neutral note, not a problem', () => {
    const r5 = findingsFor(report, 'R5')
    assert.equal(r5.length, 1)
    assert.equal(r5[0].plugin, 'fake-guarded-plugin')
    assert.equal(r5[0].severity, 'note')
    assert.equal(report.summary.errors, 1) // R5 must not inflate problem counts
  })
})

describe('fixes.json case base (event-level repair guidance)', () => {
  const FIXES = {
    generatedAt: '2026-09-10T00:00:00.000Z',
    modules: {
      '@deepseek-ai/dsh-client-runtime/client': {
        status: 'never-seeded',
        fix: '迁移到 @deepseek-ai/dsh-client-store（0.1.2-alpha.2 起在模块表）',
        cases: [
          { repo: 'Fisfzy/dsh-ego-browser', url: 'https://github.com/Fisfzy/dsh-ego-browser/issues/32', note: 'main/v0.8.1 已迁移，只差 publish' },
          { repo: 'RevolutionLA/dsh-dream-skin', url: 'https://github.com/RevolutionLA/dsh-dream-skin/issues/47', note: 'store-first + try/catch 兜底' },
        ],
      },
    },
  }

  it('hit: the R1 finding carries the known fix and its cases', () => {
    const report = runFixture('web', { fixes: FIXES })
    const [r1] = report.findings.filter((f) => f.rule === 'R1' && f.severity === 'error')
    const kf = r1.knownFixes?.['@deepseek-ai/dsh-client-runtime/client']
    assert.ok(kf)
    assert.match(kf.fix, /dsh-client-store/)
    assert.equal(kf.cases.length, 2)
    assert.equal(kf.cases[0].repo, 'Fisfzy/dsh-ego-browser')
  })

  it('miss: fixes without the missing module → no knownFixes block at all', () => {
    const report = runFixture('web', { fixes: { modules: { 'some-other-module': { fix: 'x', cases: [] } } } })
    const [r1] = report.findings.filter((f) => f.rule === 'R1' && f.severity === 'error')
    assert.equal(r1.knownFixes, undefined)
  })

  it('absent (offline / older site): no knownFixes, diagnosis unaffected', () => {
    const report = runFixture('web')
    const [r1] = report.findings.filter((f) => f.rule === 'R1' && f.severity === 'error')
    assert.equal(r1.knownFixes, undefined)
    assert.equal(report.summary.errors, 1)
  })

  it('text render shows the fix text and case links (zh + en)', () => {
    const report = runFixture('web', { fixes: FIXES })
    const zh = renderText(report, 'zh', '0.1.1', { color: false })
    assert.match(zh, /已知修法（来自生态案例库）/)
    assert.match(zh, /迁移到 @deepseek-ai\/dsh-client-store/)
    assert.match(zh, /Fisfzy\/dsh-ego-browser/)
    assert.match(zh, /https:\/\/github\.com\/RevolutionLA\/dsh-dream-skin\/issues\/47/)
    const en = renderText(report, 'en', '0.1.1', { color: false })
    assert.match(en, /Known fix \(from the ecosystem case base\)/)
    assert.match(en, /case: Fisfzy\/dsh-ego-browser/)
    // the issue template picks up the fix line too
    assert.match(buildIssueTemplate(report, 'zh', '0.1.1'), /已知修法：迁移到 @deepseek-ai\/dsh-client-store/)
  })
})

describe('moduleHistory (derived from the real bundled seed snapshot)', () => {
  const versions = Object.keys(SEEDS.versions).sort(compareVersions)
  const seedsByVersion = new Map(versions.map((v) => [v, new Set(SEEDS.versions[v])]))

  it('never: @deepseek-ai/dsh-client-runtime/* was never in any published shell', () => {
    assert.deepEqual(moduleHistory('@deepseek-ai/dsh-client-runtime/client', versions, seedsByVersion), { kind: 'never' })
  })

  it('removed: @deepseek-ai/dsh-client-web-react dropped in 0.1.0-rc.8', () => {
    const h = moduleHistory('@deepseek-ai/dsh-client-web-react', versions, seedsByVersion)
    assert.equal(h.kind, 'shipped')
    assert.equal(h.since, '0.0.1-rc.5')
    assert.equal(h.last, '0.1.0-rc.7')
    assert.equal(h.removedIn, '0.1.0-rc.8')
  })

  it('added later: @deepseek-ai/dsh-client-store entered in 0.1.2-alpha.2 and never left', () => {
    const h = moduleHistory('@deepseek-ai/dsh-client-store', versions, seedsByVersion)
    assert.equal(h.kind, 'shipped')
    assert.equal(h.since, '0.1.2-alpha.2')
    assert.equal(h.removedIn, null)
  })

  it('added later: @deepseek-ai/dsh-client-ui-dockkit entered in 0.1.5-alpha.1', () => {
    const h = moduleHistory('@deepseek-ai/dsh-client-ui-dockkit', versions, seedsByVersion)
    assert.equal(h.since, '0.1.5-alpha.1')
    assert.equal(h.removedIn, null)
  })
})

describe('resolveSeedVersion', () => {
  const versions = Object.keys(SEEDS.versions).sort(compareVersions)

  it('exact match', () => {
    assert.deepEqual(resolveSeedVersion('0.1.2-rc.1', versions), { version: '0.1.2-rc.1', source: 'exact' })
  })

  it('in-range gap → nearest older table', () => {
    assert.deepEqual(resolveSeedVersion('0.1.3-alpha.1', versions), { version: '0.1.2-rc.1', source: 'approx-lower' })
  })

  it('shell newer than every known table → snapshot-older caveat', () => {
    assert.deepEqual(resolveSeedVersion('9.9.9', versions), { version: '0.1.5-alpha.1', source: 'snapshot-older' })
  })

  it('shell older than every known table → unavailable (R1 skipped)', () => {
    assert.deepEqual(resolveSeedVersion('0.0.0', versions), { version: null, source: 'unavailable' })
  })
})
