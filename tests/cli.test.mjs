/**
 * End-to-end CLI tests: spawn bin/dsh-why.mjs against the fixture DSH_HOME /
 * npm-global root (env overrides) and assert exit codes + output shapes.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
    // stdin is not part of these assertions — give the child /dev/null so the
    // CLI's auto-detect never sits on an inherited test-runner pipe.
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function runCliWithStdin(args, input, env = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
      DSH_HOME: join(FIXTURES, 'dsh-home'),
      DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global'),
      NO_COLOR: '1',
      ...env,
    },
    input,
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
    const expected = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    const { status, stdout } = runCli(['--version'])
    assert.equal(status, 0)
    assert.equal(stdout.trim(), expected)
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
    // the issue we file for the user carries the tool's own short link
    assert.match(report.issueTemplate, /https:\/\/dsh-why\.com/)
    assert.doesNotMatch(report.issueTemplate, /github\.com\/ice5kysl\/dsh-why/)
  })

  it('clean fixture profile: exit 0 and a green summary', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'clean'])
    assert.equal(status, 0)
    assert.match(stdout, /All clear/)
  })

  it('the tip line points at the docs link', () => {
    const { stdout } = runCli(['--offline', '--profile', 'clean'])
    assert.match(stdout, /Docs: https:\/\/dsh-why\.com/)
    const zh = runCli(['--offline', '--profile', 'clean', '--lang', 'zh'])
    assert.match(zh.stdout, /文档：https:\/\/dsh-why\.com/)
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

  it('R6: integrity fixture profile reports the missing plugin as crash-level', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'integrity'])
    assert.equal(status, 1)
    assert.match(stdout, /\[ERROR·R6\] fake-missing-plugin/)
    assert.match(stdout, /\[WARN·R6\] fake-leftover-plugin/)
    assert.match(stdout, /\[WARN·R6\] fake-disabled-gone/)
    assert.doesNotMatch(stdout, /R6\] fake-healthy-plugin/) // the pnpm symlink must not be flagged
  })

  it('graph rows: undeclared lazy row → conditional warning, exit 0 (the vision-router class)', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'rows'])
    assert.equal(status, 0)
    assert.match(stdout, /shell graph rows: 1 immediate \+ 1 lazy/)
    assert.match(stdout, /\[WARN·R1\] fake-row-plugin: resolves only conditionally/)
    assert.match(stdout, /declare them in the plugin’s dsh\.client\.external/)
    assert.doesNotMatch(stdout, /crashes the loader/)
    assert.doesNotMatch(stdout, /fake-row-declared-plugin/) // declared → silent
    assert.match(stdout, /1 conditional require\(s\)/)
  })

  it('offline conditional finding still shows the bundled case-base recipe', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'rows'])
    assert.equal(status, 0)
    assert.match(stdout, /Known fix \(from the BUNDLED case-base snapshot/)
    assert.match(stdout, /dsh\.client\.external/)
    assert.doesNotMatch(stdout, /Issue template/) // still not a public-issue trigger
  })

  it('graph rows unreadable → unclassified warnings, exit 0, and a loud caveat', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'web'], {
      DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global-partial'),
    })
    assert.equal(status, 0)
    assert.match(stdout, /shell graph rows: UNREADABLE/)
    assert.match(stdout, /\[WARN·R1\] fake-crash-plugin: require\(s\) could not be classified/)
    assert.match(stdout, /not a crash verdict/)
    assert.match(stdout, /unclassified require\(s\)/)
    assert.doesNotMatch(stdout, /crashes the loader/)
    assert.doesNotMatch(stdout, /Issue template/)
  })

  it('graph rows scan-only fallback is disclosed, verdicts keep working', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'web'], {
      DSH_WHY_NPM_ROOT: join(FIXTURES, 'npm-global-noroster'),
    })
    assert.equal(status, 1) // the never-shipped module is still a real crash
    assert.match(stdout, /shell graph rows: 3 client package\(s\) found/)
    assert.match(stdout, /\[ERROR·R1\] fake-crash-plugin/)
  })

  it('--error with inline text diagnoses the pasted references', () => {
    const { status, stdout } = runCli([
      '--offline',
      '--error',
      'HARNESS Failed to load plugins: failed to import loader entry f059e6c1 (dsh-workspace-kit): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table',
    ])
    assert.equal(status, 1)
    assert.match(stdout, /Parsed error/)
    assert.match(stdout, /plugin reference\(s\): dsh-workspace-kit/)
    assert.match(stdout, /\[ERROR·R1\] dsh-workspace-kit/)
  })

  it('piped stdin is auto-detected (no --error flag needed)', () => {
    const { status, stdout } = runCliWithStdin(
      ['--offline'],
      'client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table\n',
    )
    assert.equal(status, 1)
    assert.match(stdout, /module reference\(s\): @deepseek-ai\/dsh-client-runtime\/client/)
  })

  it('unrecognized pasted error exits 0 with the honest unknown answer', () => {
    const { status, stdout } = runCliWithStdin(['--offline'], 'some totally unknown failure\n')
    assert.equal(status, 0)
    assert.match(stdout, /I don’t recognize this error pattern/)
  })

  it('--prompt appends the agent-ready fix prompt; JSON carries fixPrompt', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'web', '--prompt'])
    assert.equal(status, 1)
    assert.match(stdout, /AI fix prompt/)
    assert.match(stdout, /seed-safe/)
    const json = runCli(['--offline', '--profile', 'web', '--json'])
    const report = JSON.parse(json.stdout)
    assert.match(report.fixPrompt, /Fix a dsh \(DeepSeek Harness\) plugin load failure/)
    assert.match(report.fixPrompt, /@deepseek-ai\/dsh-client-runtime\/client/)
    assert.equal(report.fixPrompt.includes('react'), true) // seed words listed in the constraint
  })

  it('--prompt on a healthy profile says nothing to fix', () => {
    const { status, stdout } = runCli(['--offline', '--profile', 'clean', '--prompt'])
    assert.equal(status, 0)
    assert.match(stdout, /Nothing to fix/)
  })
})
