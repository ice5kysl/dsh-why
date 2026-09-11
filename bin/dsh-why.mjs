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

import { fstatSync, readFileSync } from 'node:fs'

import { detectLang, t } from '../lib/i18n.mjs'
import { runDiagnosis } from '../lib/diagnose.mjs'
import { buildRunReport } from '../lib/runrules.mjs'
import { buildFixPrompt, buildIssueTemplate, renderRunText, renderText } from '../lib/report.mjs'
import { buildSharePayloads, postShare } from '../lib/share.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const VERSION = pkg.version

function runUsage(lang) {
  const zh = lang === 'zh'
  return zh
    ? `dsh-why run v${VERSION} —— 给一次 dsh run 定性（只读本地会话日志）

用法：dsh-why run [选项]

选项：
  --all               看健康视图：扫描全部会话，区分「长期噪声」与「异常日」
  --limit <n>         --all 时最多扫描多少个日志（默认 200，按新到旧）
  --json              机器可读输出（与文本渲染消费同一个对象）
  --dsh-home <path>   覆盖 DSH_HOME（默认 ~/.dsh）
  --lang <zh|en>      输出语言（默认按 LANG/LC_ALL 粗判）
  --no-color          关闭颜色
  --help              本帮助

判定档位（绝不把盲区变成红牌）：
  完成 / 你主动停止   → 不算故障
  已归因（error）     → 有 error code 与 provider 原话支撑
  无法定性            → run 没跑完或日志被截断：明说不知道，不猜

退出码：0 范围内无失败 run，1 有失败 run，2 用法错误。`
    : `dsh-why run v${VERSION} — attribute a dsh run (reads local session logs only)

Usage: dsh-why run [options]

Options:
  --all               health view: scan every session, separating chronic noise from incidents
  --limit <n>         with --all, how many logs to scan (default 200, newest first)
  --json              machine-readable report (the same object the text renderer consumes)
  --dsh-home <path>   override DSH_HOME (default: ~/.dsh)
  --lang <zh|en>      output language (default: guessed from LANG/LC_ALL)
  --no-color          disable colors
  --help              this help

Verdict tiers (a blind spot is never turned into a red card):
  completed / stopped by you  → not a failure
  attributed (error)          → backed by an error code and the provider's own words
  unclassified                → the run never finished or the log is truncated: said plainly, never guessed

Exit codes: 0 = no failed run in scope, 1 = a failed run, 2 = usage error.`
}

function usage(lang, command = 'diagnose') {
  if (command === 'run') return runUsage(lang)
  const zh = lang === 'zh'
  return zh
    ? `dsh-why v${VERSION} —— dsh（DeepSeek Harness）失败诊断

用法：dsh-why [选项]
      dsh-why run [选项]   给一次 run 定性（见 dsh-why run --help）

选项：
  --json              机器可读输出（CI / 喂给 LLM）
  --offline           不联网，仅用包内规则库
  --profile <name>    诊断指定 profile（默认 web，或唯一的那个）
  --package <dir>     插件作者自检：诊断一个插件目录（发版前门禁）
  --dsh-home <path>   覆盖 DSH_HOME（默认 ~/.dsh）
  --error [文本]      解析粘贴的报错文本（缺省读 stdin，管道输入自动识别）
  --prompt            末尾附可粘给 AI agent 的修复 prompt
  --share             上报崩溃级 finding 到生态案例库（opt-in；发送前打印
                      完整 payload——只有结构化字段，绝无消息/路径/prompt）
  --lang <zh|en>      输出语言（默认按 LANG/LC_ALL 粗判）
  --no-color          关闭颜色
  --version           打印版本
  --help              本帮助

只读工具：永远不修改你的任何文件。
退出码：0 无崩溃级问题 · 1 有崩溃级问题 · 3 检查无法执行（--package 指向未构建的仓库或没有 package.json 的路径）· 2 用法错误。

CI 门禁写法：npx dsh-why --package . && npm publish    （任何非 0 都必须拦住发版）`
    : `dsh-why v${VERSION} — dsh (DeepSeek Harness) failure diagnostics

Usage: dsh-why [options]
       dsh-why run [options]   attribute a run (see: dsh-why run --help)

Options:
  --json              machine-readable report (CI / feed to an LLM)
  --offline           no network — bundled local rule base only
  --profile <name>    diagnose a specific profile (default: web, or the only one)
  --package <dir>     plugin-author self-check: diagnose one plugin directory
                      (a pre-publish gate — exit 3 means it could not check)
  --dsh-home <path>   override DSH_HOME (default: ~/.dsh)
  --error [text]      parse a pasted error text (reads stdin when omitted; pipes auto-detected)
  --prompt            append a paste-ready fix prompt for an AI agent
  --share             share crash-level findings with the ecosystem case base
                      (opt-in; the exact payload is printed before sending —
                      structured fields only, never messages/paths/prompts)
  --lang <zh|en>      output language (default: guessed from LANG/LC_ALL)
  --no-color          disable colors
  --version           print version
  --help              this help

Read-only by design: never modifies any file.
Exit codes: 0 = no crash-level findings · 1 = crash-level findings · 3 = the check COULD NOT BE PERFORMED (--package pointed at an unbuilt checkout or a path with no package.json) · 2 = usage error.

CI gate: npx dsh-why --package . && npm publish    (any non-zero must block the release)`
}

function parseArgs(argv) {
  const opts = { json: false, offline: false, noColor: false, prompt: false, share: false, lang: null, profile: null, packageDir: null, dshHome: null, error: null, all: false, limit: 200, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--offline') opts.offline = true
    else if (arg === '--no-color') opts.noColor = true
    else if (arg === '--prompt') opts.prompt = true
    else if (arg === '--share') opts.share = true
    else if (arg === '--all') opts.all = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--version' || arg === '-v') opts.version = true
    else if (arg === '--lang') opts.lang = argv[++i]
    else if (arg.startsWith('--lang=')) opts.lang = arg.slice('--lang='.length)
    else if (arg === '--limit') opts.limit = Number(argv[++i])
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length))
    else if (arg === '--profile') opts.profile = argv[++i]
    else if (arg.startsWith('--profile=')) opts.profile = arg.slice('--profile='.length)
    else if (arg === '--package') opts.packageDir = argv[++i]
    else if (arg.startsWith('--package=')) opts.packageDir = arg.slice('--package='.length)
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
  if (!Number.isFinite(opts.limit) || opts.limit < 1) return { error: `--limit ${opts.limit}` }
  return { opts }
}

/**
 * What kind of stdin do we have? A character device is /dev/null — the usual
 * non-interactive stdin in CI and in process runners — and it will NEVER deliver
 * data; waiting on it just costs every run the full timeout. Pipes, redirected
 * files and sockets can deliver.
 * @returns {'tty'|'none'|'pipe'|'file'|'socket'}
 */
function stdinKind() {
  if (process.stdin.isTTY) return 'tty'
  try {
    const st = fstatSync(0)
    if (st.isFIFO()) return 'pipe'
    if (st.isFile()) return 'file'
    if (typeof st.isSocket === 'function' && st.isSocket()) return 'socket'
  } catch { /* fall through */ }
  return 'none'
}

/**
 * Read piped stdin with a bounded wait; null when there is nothing to read.
 * `patient` (an explicit `--error` with no value) waits a few seconds for a
 * human to finish typing/pasting; auto-detection waits only long enough for a
 * shell pipe to deliver — a stray inherited-but-idle stdin (the node --test
 * runner, some CI shells) must not add seconds to every invocation.
 */
async function readStdin({ patient = false } = {}) {
  const kind = stdinKind()
  if (kind === 'tty' || kind === 'none') return null
  const timeoutMs = patient ? 3000 : 500
  process.stdin.setEncoding('utf8')
  try {
    const text = await Promise.race([
      (async () => {
        let data = ''
        for await (const chunk of process.stdin) data += chunk
        return data
      })(),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(null), timeoutMs)),
    ])
    return typeof text === 'string' && text.trim() ? text : null
  } finally {
    // A half-consumed stdin must never hold the event loop open after we are done.
    try { process.stdin.destroy() } catch { /* already closed */ }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  // `dsh-why run` is the run-forensics face; bare `dsh-why` is the startup check.
  const command = argv[0] === 'run' ? 'run' : 'diagnose'
  const parsed = parseArgs(command === 'run' ? argv.slice(1) : argv)
  const preLang = detectLang(process.env, parsed.opts?.lang ?? null)
  if (parsed.error) {
    console.error(`${preLang === 'zh' ? '无法识别的参数' : 'unrecognized option'}: ${parsed.error}\n`)
    console.error(usage(preLang, command))
    process.exitCode = 2
    return
  }
  const { opts } = parsed
  const lang = detectLang(process.env, opts.lang)
  if (opts.help) { console.log(usage(lang, command)); return }
  if (opts.version) { console.log(VERSION); return }

  if (command === 'run') {
    const report = buildRunReport({
      dshHome: opts.dshHome,
      scope: opts.all ? 'all' : 'latest',
      limit: opts.limit,
    })
    if (opts.json) {
      console.log(JSON.stringify({ ...report, tool: { name: 'dsh-why', version: VERSION } }, null, 2))
    } else {
      const color = !opts.noColor && process.stdout.isTTY && !process.env.NO_COLOR
      console.log(renderRunText(report, lang, VERSION, { color }))
    }
    // A failed run in scope is the gate. `--all` therefore reports 1 whenever the
    // window contains any failure — that is the intended CI semantic.
    process.exitCode = report.summary.errors > 0 ? 1 : 0
    return
  }

  // Error input precedence: --error <text> > --error (stdin) > piped stdin.
  let errorText = null
  if (typeof opts.error === 'string' && opts.error.trim()) errorText = opts.error
  // --error with no value is the explicit "I'm piping text" signal (patient);
  // otherwise auto-detect piped stdin with a short, non-penalising wait.
  else errorText = await readStdin({ patient: opts.error === '' })

  const report = await runDiagnosis({
    env: process.env,
    dshHome: opts.dshHome,
    profile: opts.profile,
    packageDir: opts.packageDir,
    offline: opts.offline,
    errorText,
  })

  // --share (opt-in): send crash-level findings to the ecosystem case base.
  // The exact payload is disclosed before it goes out — that disclosure is the
  // consent surface, so it stays even in --json mode (as a `share` key).
  let shareResults = null
  if (opts.share) {
    const payloads = buildSharePayloads(report)
    const endpoint = process.env.DSH_WHY_SHARE_ENDPOINT || undefined
    shareResults = []
    if (!payloads.length) {
      shareResults.push({ ok: false, skipped: true, reason: 'no-crash-level-findings' })
    } else {
      for (const payload of payloads) {
        shareResults.push({ payload, ...(await postShare(payload, { endpoint })) })
      }
    }
  }

  if (opts.json) {
    const out = {
      ...report,
      tool: { name: 'dsh-why', version: VERSION },
      issueTemplate: buildIssueTemplate(report, lang, VERSION),
      fixPrompt: buildFixPrompt(report, lang, VERSION),
      ...(shareResults ? { share: shareResults } : {}),
    }
    console.log(JSON.stringify(out, null, 2))
  } else {
    const color = !opts.noColor && process.stdout.isTTY && !process.env.NO_COLOR
    console.log(renderText(report, lang, VERSION, { color, showPrompt: opts.prompt }))
    if (shareResults) {
      const zh = lang === 'zh'
      const lines = [zh ? '── 上报生态案例库（--share）──' : '── share with the case base (--share) ──']
      for (const r of shareResults) {
        if (r.skipped) {
          lines.push(zh ? '没有崩溃级 finding，无可上报内容。' : 'No crash-level findings — nothing to share.')
        } else {
          lines.push((zh ? '发送内容：' : 'payload: ') + JSON.stringify(r.payload))
          lines.push(
            r.ok
              ? (zh ? `已上报 ✓（${r.id ?? 'ok'}）` : `shared ✓ (${r.id ?? 'ok'})`)
              : (zh ? `上报失败（不影响诊断）：${r.error}` : `share failed (diagnosis unaffected): ${r.error}`),
          )
        }
      }
      console.log(lines.join('\n'))
    }
  }

  // Exit codes, in order of what a caller must do about it:
  //   0  nothing crash-level was found
  //   1  a crash-level finding — the plugin will break the loader
  //   3  the check COULD NOT BE PERFORMED (--package on an unbuilt checkout, or
  //      on a path with no manifest). Deliberately non-zero: for a pre-publish
  //      gate, a green light it did not earn is worse than a red one.
  //   2  usage error or an internal bug (set above / below)
  if (report.summary.errors > 0) process.exitCode = 1
  else if (report.packageMode && report.summary.unclassified > 0) process.exitCode = 3
  else process.exitCode = 0
}

main().catch((error) => {
  // The diagnostic tool must never crash; if it does, say so plainly.
  console.error(`dsh-why: internal error (please report: https://github.com/ice5kysl/dsh-why/issues): ${error?.message ?? error}`)
  process.exitCode = 2
})
