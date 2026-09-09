#!/usr/bin/env node
/**
 * dsh-why — dsh (DeepSeek Harness) failure diagnostics.
 *
 *   npx dsh-why            diagnose the current environment
 *   npx dsh-why --json     machine-readable report
 *   npx dsh-why --offline  local rule base only, zero network
 *
 * Read-only by design: nothing on the user's machine is ever modified.
 * Exit code 0 = no crash-level findings, 1 = crash-level findings, 2 = usage error.
 */

import { readFileSync } from 'node:fs'

import { detectLang, t } from '../lib/i18n.mjs'
import { runDiagnosis } from '../lib/diagnose.mjs'
import { buildFixPrompt, buildIssueTemplate, renderText } from '../lib/report.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const VERSION = pkg.version

function usage(lang) {
  const zh = lang === 'zh'
  return zh
    ? `dsh-why v${VERSION} —— dsh（DeepSeek Harness）失败诊断

用法：dsh-why [选项]

选项：
  --json              机器可读输出（CI / 喂给 LLM）
  --offline           不联网，仅用包内规则库
  --profile <name>    诊断指定 profile（默认 web，或唯一的那个）
  --dsh-home <path>   覆盖 DSH_HOME（默认 ~/.dsh）
  --error [文本]      解析粘贴的报错文本（缺省读 stdin，管道输入自动识别）
  --prompt            末尾附可粘给 AI agent 的修复 prompt
  --lang <zh|en>      输出语言（默认按 LANG/LC_ALL 粗判）
  --no-color          关闭颜色
  --version           打印版本
  --help              本帮助

只读工具：永远不修改你的任何文件。退出码：0 无崩溃级问题，1 有崩溃级问题。`
    : `dsh-why v${VERSION} — dsh (DeepSeek Harness) failure diagnostics

Usage: dsh-why [options]

Options:
  --json              machine-readable report (CI / feed to an LLM)
  --offline           no network — bundled local rule base only
  --profile <name>    diagnose a specific profile (default: web, or the only one)
  --dsh-home <path>   override DSH_HOME (default: ~/.dsh)
  --error [text]      parse a pasted error text (reads stdin when omitted; pipes auto-detected)
  --prompt            append a paste-ready fix prompt for an AI agent
  --lang <zh|en>      output language (default: guessed from LANG/LC_ALL)
  --no-color          disable colors
  --version           print version
  --help              this help

Read-only by design: never modifies any file. Exit codes: 0 = no crash-level findings, 1 = crash-level findings.`
}

function parseArgs(argv) {
  const opts = { json: false, offline: false, noColor: false, prompt: false, lang: null, profile: null, dshHome: null, error: null, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--offline') opts.offline = true
    else if (arg === '--no-color') opts.noColor = true
    else if (arg === '--prompt') opts.prompt = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--version' || arg === '-v') opts.version = true
    else if (arg === '--lang') opts.lang = argv[++i]
    else if (arg.startsWith('--lang=')) opts.lang = arg.slice('--lang='.length)
    else if (arg === '--profile') opts.profile = argv[++i]
    else if (arg.startsWith('--profile=')) opts.profile = arg.slice('--profile='.length)
    else if (arg === '--dsh-home') opts.dshHome = argv[++i]
    else if (arg.startsWith('--dsh-home=')) opts.dshHome = arg.slice('--dsh-home='.length)
    else if (arg === '--error') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { opts.error = next; i++ }
      else opts.error = '' // explicit --error with no value → read stdin
    }
    else if (arg.startsWith('--error=')) opts.error = arg.slice('--error='.length)
    else return { error: arg }
  }
  if (opts.lang !== null && opts.lang !== 'zh' && opts.lang !== 'en') return { error: `--lang ${opts.lang}` }
  return { opts }
}

/** Read piped stdin (non-TTY) with a bounded wait; null for TTY / empty / timeout. */
async function readStdin(timeoutMs = 3000) {
  if (process.stdin.isTTY) return null
  process.stdin.setEncoding('utf8')
  const text = await Promise.race([
    (async () => {
      let data = ''
      for await (const chunk of process.stdin) data += chunk
      return data
    })(),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(null), timeoutMs)),
  ])
  return typeof text === 'string' && text.trim() ? text : null
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  const preLang = detectLang(process.env, parsed.opts?.lang ?? null)
  if (parsed.error) {
    console.error(`${preLang === 'zh' ? '无法识别的参数' : 'unrecognized option'}: ${parsed.error}\n`)
    console.error(usage(preLang))
    process.exit(2)
  }
  const { opts } = parsed
  const lang = detectLang(process.env, opts.lang)
  if (opts.help) { console.log(usage(lang)); process.exit(0) }
  if (opts.version) { console.log(VERSION); process.exit(0) }

  // Error input precedence: --error <text> > --error (stdin) > piped stdin.
  let errorText = null
  if (typeof opts.error === 'string' && opts.error.trim()) errorText = opts.error
  else if (opts.error === '' || !process.stdin.isTTY) errorText = await readStdin()

  const report = await runDiagnosis({
    env: process.env,
    dshHome: opts.dshHome,
    profile: opts.profile,
    offline: opts.offline,
    errorText,
  })

  if (opts.json) {
    const out = {
      ...report,
      tool: { name: 'dsh-why', version: VERSION },
      issueTemplate: buildIssueTemplate(report, lang, VERSION),
      fixPrompt: buildFixPrompt(report, lang, VERSION),
    }
    console.log(JSON.stringify(out, null, 2))
  } else {
    const color = !opts.noColor && process.stdout.isTTY && !process.env.NO_COLOR
    console.log(renderText(report, lang, VERSION, { color, showPrompt: opts.prompt }))
  }

  process.exit(report.summary.errors > 0 ? 1 : 0)
}

main().catch((error) => {
  // The diagnostic tool must never crash; if it does, say so plainly.
  console.error(`dsh-why: internal error (please report: https://github.com/ice5kysl/dsh-why/issues): ${error?.message ?? error}`)
  process.exit(2)
})
