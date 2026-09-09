/**
 * End-to-end CLI tests: spawn bin/dsh-why.mjs against the fixture DSH_HOME /
 * npm-global root (env overrides) and assert exit codes + output shapes.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'dsh-why.mjs')
const FIXTURES = join(ROOT, 'tests', 'fixtures')

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
      DSH_HOME: join(FIXTURES, 'dsh-home'),
      DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global'),
      NO_COLOR: '1',
      ...env,
    },
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('dsh-why CLI', () => {
  it('--help prints usage and exits 0', () => {
    const { status, stdout } = runCli(['--help'])
    assert.equal(status, 0)
    assert.match(stdout, /--offline/)
    assert.match(stdout, /--json/)
  })

  it('--version prints the package version', () => {
    const { status, stdout } = runCli(['--version'])
    assert.equal(status, 0)
    assert.match(stdout.trim(), /^0\.1\.0$/)
  })

  it('unknown option → usage error exit 2', () => {
    const { status } = runCli(['--wat'])
    assert.equal(status, 2)
  })

  it('broken fixture profile: exit 1, JSON carries the R1 crash finding', () => {
    const { status, stdout } = runCli(['--offline', '--json', '--profile', 'web'])
    assert.equal(status, 1)
    const report = JSON.parse(stdout)
    assert.equal(report.mode, 'offline')
    assert.equal(report.tool.name, 'dsh-why')
    assert.equal(report.install.dshVersion, '0.1.2-rc.1')
    assert.equal(report.seed.version, '0.1.2-rc.1')
    assert.equal(report.summary.errors, 1)
    const r1 = report.findings.find((f) => f.rule === 'R1')
    assert.equal(r1.plugin, 'fake-crash-plugin')
    assert.deepEqual(r1.missing, ['@deepseek-ai/dsh-client-runtime/client'])
    assert.match(report.issueTemplate, /fake-crash-plugin@1\.0\.0/)
    assert.match(report.issueTemplate, /missed the module table/)
  })

  it('clean fixture profile: exit 0 and a green summary', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'clean'])
    assert.equal(status, 0)
    assert.match(stdout, /All clear/)
  })

  it('--lang zh renders Chinese', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'clean', '--lang', 'zh'])
    assert.equal(status, 0)
    assert.match(stdout, /全部健康/)
  })

  it('zh locale env is auto-detected', () => {
    const { stdout } = runCli(['--offline', '--profile', 'clean'], { LC_ALL: 'zh_CN.UTF-8', LANG: 'zh_CN.UTF-8' })
    assert.match(stdout, /全部健康/)
  })

  it('no dsh install is a legal answer, not a crash', () => {
    const { status, stdout } = runCli(['--offline', '--json'], { DSH_WHY_NPM_ROOT: join(FIXTURES, 'nowhere') })
    assert.equal(status, 0)
    const report = JSON.parse(stdout)
    assert.equal(report.install, null)
  })

  it('missing profile is reported with the available list', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'nope'])
    assert.equal(status, 0)
    assert.match(stdout, /profile "nope" not found/)
    assert.match(stdout, /clean/)
  })
})
