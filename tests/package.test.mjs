/**
 * --package <dir>: the plugin-author pre-publish self-check. readPackage reads
 * one plugin directory into the same shape readProfile produces, and the same
 * diagnose() rule base classifies it (client bundle vs the module table,
 * engines.dsh, ecosystem cross-check).
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

  // This used to assert exit 0. That was the gate answering "all clear" about a
  // path it had never read — the one thing a pre-publish gate must not do. The
  // honest answer is a distinct non-zero: not a crash (the plugin is not proven
  // broken), but not a pass either.
  it('a missing directory → exit 3 "could not verify", never a crash', () => {
    const { status, stdout } = runPackage(join(FIXTURES, 'does-not-exist'))
    assert.equal(status, 3)
    assert.match(stdout, /not found \(no package\.json at that path\)/)
    assert.match(stdout, /the gate checked nothing/)
  })

  it('--json works for CI gating', () => {
    const { status, stdout } = runPackage(PKG('fake-crash-plugin'), ['--json'])
    assert.equal(status, 1)
    const report = JSON.parse(stdout)
    assert.equal(report.packageMode, true)
    assert.equal(report.summary.errors, 1)
  })
})

/**
 * R7 — the gate must never answer "all clear" about a check it did not perform.
 *
 * Both cases below used to exit 0. Promoting `--package` as a CI gate while it
 * could hand out an unearned green light would have been worse than not promoting
 * it at all: a gate that passes when it read nothing is a gate that certifies
 * broken releases.
 */
describe('R7 — a check that could not be performed is not a pass', () => {
  const fixture = (name, manifest, files = {}) => {
    const dir = mkdtempSync(join(tmpdir(), `dsh-why-r7-${name}-`))
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true })
      writeFileSync(join(dir, rel), body)
    }
    return dir
  }
  const CLIENT = {
    name: 'demo', version: '1.0.0',
    exports: { './client': { default: './lib/client.js' } },
    dsh: { client: { platform: 'web' } },
  }

  it('declared but unbuilt → exit 3, never "all clear"', () => {
    const dir = fixture('unbuilt', CLIENT)
    const { status, stdout } = runPackage(dir)
    assert.equal(status, 3)
    assert.match(stdout, /the gate checked nothing/)
    assert.match(stdout, /\[WARN·R7\]/)
    assert.equal(/All clear/.test(stdout), false)
  })

  it('declared but no resolvable entry at all → exit 3', () => {
    const dir = fixture('none', { name: 'demo', version: '1.0.0', dsh: { client: { platform: 'web' } } })
    const { status, stdout } = runPackage(dir)
    assert.equal(status, 3)
    assert.match(stdout, /no client bundle could be located/)
  })

  it('a host-only plugin with no client declared is still a legitimate pass', () => {
    const dir = fixture('host', { name: 'demo', version: '1.0.0' })
    assert.equal(runPackage(dir).status, 0)
  })

  it('a built bundle that requires a missing module is still a crash (exit 1, not 3)', () => {
    const dir = fixture('broken', CLIENT, { 'lib/client.js': 'require("@deepseek-ai/dsh-client-runtime/client")' })
    const { status, stdout } = runPackage(dir)
    assert.equal(status, 1)
    assert.match(stdout, /\[ERROR·R1\]/)
  })

  it('carries the reason and the entry into --json for a CI log', () => {
    const dir = fixture('json', CLIENT)
    const report = JSON.parse(runPackage(dir, ['--json']).stdout)
    assert.equal(report.summary.unclassified, 1)
    assert.equal(report.summary.errors, 0)
    assert.deepEqual(report.findings[0].reason, 'client-bundle-unbuilt')
    assert.equal(report.findings[0].entry, 'lib/client.js')
  })
})
