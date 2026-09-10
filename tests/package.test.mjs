/**
 * --package <dir>: the plugin-author pre-publish self-check. readPackage reads
 * one plugin directory into the same shape readProfile produces, and the same
 * diagnose() rule base classifies it (client bundle vs the module table,
 * engines.dsh, ecosystem cross-check).
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { readPackage } from '../lib/collect.mjs'
import { diagnose } from '../lib/rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'dsh-why.mjs')
const FIXTURES = join(ROOT, 'tests', 'fixtures')
const PKG = (name) => join(FIXTURES, 'dsh-home', 'profiles', 'web', 'node_modules', name)

const SEEDS = JSON.parse(readFileSync(join(ROOT, 'lib/data/shell-seeds.json'), 'utf8'))

function runPackage(dir, extraArgs = []) {
  const r = spawnSync(process.execPath, [BIN, '--package', dir, '--offline', ...extraArgs], {
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global'), NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('readPackage', () => {
  it('reads one plugin directory into the single-plugin shape', () => {
    const pd = readPackage(PKG('fake-crash-plugin'))
    assert.equal(pd.manifestFound, true)
    assert.equal(pd.plugins.length, 1)
    const p = pd.plugins[0]
    assert.equal(p.name, 'fake-crash-plugin')
    assert.equal(p.version, '1.0.0')
    assert.equal(p.enabled, true)
    assert.equal(p.spec.startsWith('file:'), true)
    assert.ok(p.client.requires.includes('@deepseek-ai/dsh-client-runtime/client'))
    assert.equal(p.enginesDsh, null) // the fixture declares no engines.dsh
  })

  it('returns manifestFound:false for a missing directory, never throws', () => {
    const pd = readPackage(join(FIXTURES, 'does-not-exist'))
    assert.equal(pd.manifestFound, false)
    assert.deepEqual(pd.plugins, [])
  })
})

describe('diagnose (packageMode)', () => {
  const report = diagnose({
    install: { cliVersion: '0.1.2-rc.1', shellVersion: '0.1.2-rc.1', shellPkg: '@deepseek-ai/dsh-web-frontend' },
    dshHome: PKG('fake-crash-plugin'),
    profileData: readPackage(PKG('fake-crash-plugin')),
    availableProfiles: [],
    seeds: SEEDS,
    seedsOrigin: 'bundled',
    rows: { immediate: [], lazy: [], exact: true },
    offline: true,
    packageMode: true,
    now: new Date('2026-09-10T00:00:00Z'),
  })

  it('marks the report as package mode and classifies the crash', () => {
    assert.equal(report.packageMode, true)
    assert.equal(report.summary.errors, 1)
    const r1 = report.findings.find((f) => f.rule === 'R1')
    assert.equal(r1.plugin, 'fake-crash-plugin')
    assert.equal(r1.severity, 'error')
  })

  it('the row carries hasClient for the env line', () => {
    assert.equal(report.plugins[0].hasClient, true)
  })
})

describe('dsh-why --package <dir> (CLI)', () => {
  it('a crashing plugin → exit 1 with the crash finding', () => {
    const { status, stdout } = runPackage(PKG('fake-crash-plugin'))
    assert.equal(status, 1)
    assert.match(stdout, /package: fake-crash-plugin@1\.0\.0 — pre-publish self-check/)
    assert.match(stdout, /\[ERROR·R1\] fake-crash-plugin/)
  })

  it('a healthy plugin → exit 0 with all-clear', () => {
    const { status, stdout } = runPackage(PKG('fake-healthy-plugin'))
    assert.equal(status, 0)
    assert.match(stdout, /package: fake-healthy-plugin@2\.1\.0/)
    assert.match(stdout, /All clear/)
  })

  it('a missing directory → exit 0 with an honest "not found", never a crash', () => {
    const { status, stdout } = runPackage(join(FIXTURES, 'does-not-exist'))
    assert.equal(status, 0)
    assert.match(stdout, /not found \(no package\.json at that path\)/)
  })

  it('--json works for CI gating', () => {
    const { status, stdout } = runPackage(PKG('fake-crash-plugin'), ['--json'])
    assert.equal(status, 1)
    const report = JSON.parse(stdout)
    assert.equal(report.packageMode, true)
    assert.equal(report.summary.errors, 1)
  })
})
