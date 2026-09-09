/**
 * dsh-why — bilingual (zh/en) strings and language detection.
 *
 * Detection: --lang wins; otherwise LC_ALL → LC_MESSAGES → LANG, and any
 * value starting with "zh" selects Chinese. Everything else is English.
 *
 * @module dsh-why/i18n
 */

export function detectLang(env = process.env, argvLang = null) {
  if (argvLang === 'zh' || argvLang === 'en') return argvLang
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || ''
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const dict = {
  en: {
    title: (v) => `dsh-why v${v} — dsh (DeepSeek Harness) failure diagnostics`,
    modeOffline: 'offline mode — local rule base only (ecosystem cross-check skipped)',
    modeOfflineFallback: 'upstream unreachable — degraded to the bundled local rule base',

    envTitle: 'Environment',
    envNotFound: 'No dsh installation found',
    envNotFoundHint: 'Looked for @deepseek-ai/dsh under the global npm root. If dsh is installed elsewhere, point me at it with DSH_WHY_NPM_ROOT.',
    envDsh: (v, shell, shellPkg) => `dsh: ${v} · shell (module table): ${shell} (${shellPkg})`,
    envHome: (home) => `DSH_HOME: ${home}`,
    envProfile: (name, n, enabled, baseline) => `profile: ${name} — ${n} plugin(s), ${enabled} enabled · ${baseline} in-box baseline bundle(s)`,
    envProfileMissing: (name, available) => available.length
      ? `profile "${name}" not found. Available: ${available.join(', ')} (pick one with --profile)`
      : `profile "${name}" not found, and no profiles exist under DSH_HOME yet.`,
    envSeedExact: (v, origin) => `module table: shell ${v} (${origin === 'upstream' ? 'live upstream' : 'bundled snapshot'})`,
    envSeedApprox: (shell, seed, origin) => `module table: no table for shell ${shell}; checking against the nearest older one, ${seed} (${origin === 'upstream' ? 'live upstream' : 'bundled snapshot'}) — treat red results with care`,
    envSeedOlder: (shell, seed, origin) => `module table: shell ${shell} is newer than the newest known table ${seed} (${origin === 'upstream' ? 'live upstream' : 'bundled snapshot'}); modules added recently would be misreported as missing — re-run online to refresh`,
    envSeedUnavailable: (shell) => `module table: no known table covers shell ${shell} — load-crash check (R1) skipped`,

    findingsTitle: 'Findings',
    noInstallNoCheck: 'Environment checks that need a dsh install were skipped.',

    r1Title: (plugin) => `${plugin} crashes the loader on this dsh`,
    r1Symptom: (missing) => `Symptom: "Failed to load plugins" / require("${missing[0]}") missed the module table — the client bundle requires module(s) the shell does not provide:`,
    r1Guarded: (specs) => `Guarded by try/catch (won't crash, fallback covers it): ${specs.join(', ')}`,
    histNever: 'never shipped in ANY published shell’s module table — the plugin was written against a module that does not exist in dsh',
    histRemoved: (last, removedIn) => `removed by official dsh ${removedIn} (last worked on ${last})`,
    histAddedLater: (since) => `only added to the module table in dsh ${since} — your dsh is too old for this plugin`,
    histPresent: (since) => `present since dsh ${since}`,
    r1Observed: (verdictText, repo) => `Ecosystem cross-check (dsh-insights.com observed matrix): ${verdictText}${repo ? ` — ${repo}` : ''}`,
    r1ObservedStale: (measured, installed) => `the matrix measured v${measured}, you run v${installed} — the verdict may not apply to your version`,
    r1Ecosystem: (n) => `You are not alone: ${n} plugin(s) across the ecosystem miss the same module.`,
    r1FixTitle: 'How to fix (pick one):',
    r1FixUpgradePlugin: (name, latest) => `upgrade the plugin — npm has ${name}@${latest}: re-add it (dsh plugin remove ${name} && dsh plugin add ${name})`,
    r1FixUpgradeDsh: (since) => `upgrade dsh to >= ${since} (the missing module entered the module table there): npm i -g @deepseek-ai/dsh@latest`,
    r1FixDowngradeDsh: (last) => `temporarily downgrade dsh to ${last} (the last shell whose module table still had it): npm i -g @deepseek-ai/dsh@${last}`,
    r1FixRemove: (name) => `remove the plugin to get dsh booting again: dsh plugin remove ${name}`,
    r1FixIssue: 'report it to the plugin author — a copy-ready issue template is attached below',
    r1KnownFixTitle: 'Known fix (from the ecosystem case base):',
    r1KnownFixCase: (repo, note, url) => `case: ${repo}${note ? ` — ${note}` : ''}${url ? ` (${url})` : ''}`,

    r2Title: (plugin) => `${plugin}: declared dsh range does not cover your dsh`,
    r2Detail: (range, v) => `engines.dsh is "${range}" but the installed dsh is ${v}. The plugin may rely on APIs your dsh does not have (or no longer has).`,
    r2Undecidable: (range) => `engines.dsh "${range}" could not be evaluated (unusual range syntax) — check it by hand.`,
    r2Fix: (name) => `check ${name}’s releases for a build declaring support for your dsh, or pin dsh to a covered version.`,

    r3Title: (plugin) => `${plugin}: a newer release exists`,
    r3Detail: (installed, latest) => `installed ${installed} → npm latest ${latest}. When in doubt, upgrade first and re-run dsh-why.`,

    r5Title: (plugin) => `${plugin}: not in the observed-compat matrix`,
    r5Detail: 'This plugin was not measured by dsh-insights.com (unpublished, too new, or outside the corpus). Not a problem by itself — local checks above still apply.',

    severity: { error: 'ERROR', warning: 'WARN', info: 'INFO', note: 'note' },

    greenTitle: (n) => `All clear — ${n} plugin(s) load fine on this dsh`,
    greenDetail: 'Every enabled plugin’s client requires resolve against the shell’s module table, and declared dsh ranges cover your version.',
    yellowTitle: (w) => `No crashes, but ${w} warning(s) deserve attention`,
    redTitle: (e) => `${e} crash-level problem(s) found`,

    issueTitle: 'Issue template (copy into the plugin’s GitHub issue):',
    issueHeading: '### dsh plugin fails to load — dsh-why diagnostic report',
    issueEnv: (dsh, shell, profile) => `- dsh: ${dsh} · shell: ${shell} · profile: ${profile}`,
    issueTool: (v) => `- diagnosed by: dsh-why v${v} (https://github.com/ice5kysl/dsh-why)`,
    issuePlugin: (name, version) => `- plugin: ${name}@${version ?? 'not-installed'}`,
    issueMissing: (specs) => `- missing module(s) at runtime: ${specs.map((s) => `\`${s}\``).join(', ')}`,
    issueError: (spec) => `- loader error: \`client-modules: require("${spec}") missed the module table\``,
    issueHistory: (line) => `- module history: ${line}`,
    issueFix: (fix) => `- known fix: ${fix}`,
    issueAsk: 'Could you guard this require with try/catch (the loader resolves require() at call time) or switch to a module the current shell provides? Thanks!',

    verdictText: {
      ok: 'loads on every published shell',
      never: 'never loaded on ANY published shell (broken since its first release)',
      'broken-since': (since, okUntil) => `breaks on dsh >= ${since} (worked up to ${okUntil})`,
      'supported-since': (since) => `only loads on dsh >= ${since}`,
      mixed: 'inconsistent across shells',
    },

    hintJson: 'Tip: --json for machine-readable output, --offline to skip all network, --lang zh for 中文.',
  },

  zh: {
    title: (v) => `dsh-why v${v} —— dsh（DeepSeek Harness）失败诊断`,
    modeOffline: '离线模式 —— 仅用本地规则库（跳过生态对照）',
    modeOfflineFallback: '线上数据不可达 —— 已降级为包内本地规则库',

    envTitle: '环境摘要',
    envNotFound: '未找到 dsh 安装',
    envNotFoundHint: '已在全局 npm root 下查找 @deepseek-ai/dsh。若 dsh 装在别处，可用 DSH_WHY_NPM_ROOT 指给我。',
    envDsh: (v, shell, shellPkg) => `dsh：${v} · shell（模块表）：${shell}（${shellPkg}）`,
    envHome: (home) => `DSH_HOME：${home}`,
    envProfile: (name, n, enabled, baseline) => `profile：${name} —— ${n} 个插件，${enabled} 个启用 · 内置基线 ${baseline} 个`,
    envProfileMissing: (name, available) => available.length
      ? `找不到 profile「${name}」。现有：${available.join('、')}（用 --profile 选择）`
      : `找不到 profile「${name}」，且 DSH_HOME 下还没有任何 profile。`,
    envSeedExact: (v, origin) => `模块表：shell ${v}（${origin === 'upstream' ? '线上实时' : '包内快照'}）`,
    envSeedApprox: (shell, seed, origin) => `模块表：没有 shell ${shell} 的表，改用最近旧版 ${seed} 对照（${origin === 'upstream' ? '线上实时' : '包内快照'}）——红色结论请谨慎对待`,
    envSeedOlder: (shell, seed, origin) => `模块表：你的 shell ${shell} 比已知最新表 ${seed} 还新（${origin === 'upstream' ? '线上实时' : '包内快照'}）——新版补的模块可能被误报缺失，建议联网重跑刷新`,
    envSeedUnavailable: (shell) => `模块表：没有任何已知表覆盖 shell ${shell} —— 跳过加载即崩检查（R1）`,

    findingsTitle: '问题列表',
    noInstallNoCheck: '依赖 dsh 安装的检查已跳过。',

    r1Title: (plugin) => `${plugin} 在当前 dsh 上加载即崩`,
    r1Symptom: (missing) => `现象：「Failed to load plugins」红屏 / require("${missing[0]}") missed the module table —— 插件 client bundle 引用了 shell 模块表不提供的模块：`,
    r1Guarded: (specs) => `有 try/catch 兜底（不会崩，降级路径可用）：${specs.join('、')}`,
    histNever: '从未进入任何已发布 shell 的模块表 —— 插件引用了一个 dsh 里根本不存在的模块',
    histRemoved: (last, removedIn) => `官方 dsh ${removedIn} 起被移除（最后在 ${last} 可用）`,
    histAddedLater: (since) => `dsh ${since} 起才加入模块表 —— 你的 dsh 版本对这个插件来说太旧`,
    histPresent: (since) => `自 dsh ${since} 起在表`,
    r1Observed: (verdictText, repo) => `生态对照（dsh-insights.com 实测矩阵）：${verdictText}${repo ? ` —— ${repo}` : ''}`,
    r1ObservedStale: (measured, installed) => `矩阵实测的是 v${measured}，你装的是 v${installed} —— 结论未必适用当前版本`,
    r1Ecosystem: (n) => `你不是唯一踩坑的：全生态有 ${n} 个插件缺同一个模块。`,
    r1FixTitle: '修法（任选其一）：',
    r1FixUpgradePlugin: (name, latest) => `升级插件 —— npm 已有 ${name}@${latest}：重装（dsh plugin remove ${name} && dsh plugin add ${name}）`,
    r1FixUpgradeDsh: (since) => `升级 dsh 到 >= ${since}（缺失模块在该版本进入模块表）：npm i -g @deepseek-ai/dsh@latest`,
    r1FixDowngradeDsh: (last) => `临时把 dsh 降回 ${last}（最后一个模块表还含它的 shell）：npm i -g @deepseek-ai/dsh@${last}`,
    r1FixRemove: (name) => `移除插件让 dsh 先能启动：dsh plugin remove ${name}`,
    r1FixIssue: '给插件作者提 issue —— 下方附可直接复制的模板',
    r1KnownFixTitle: '已知修法（来自生态案例库）：',
    r1KnownFixCase: (repo, note, url) => `案例：${repo}${note ? ` —— ${note}` : ''}${url ? `（${url}）` : ''}`,

    r2Title: (plugin) => `${plugin}：声明的 dsh 版本范围不覆盖你的 dsh`,
    r2Detail: (range, v) => `engines.dsh 声明为「${range}」，而当前 dsh 是 ${v}。插件可能依赖你的 dsh 还没有（或已移除）的 API。`,
    r2Undecidable: (range) => `engines.dsh「${range}」无法解析（非常规写法）—— 请人工核对。`,
    r2Fix: (name) => `看看 ${name} 是否有声明支持你当前 dsh 的新版本，或把 dsh 固定在覆盖范围内。`,

    r3Title: (plugin) => `${plugin}：有新版本可升`,
    r3Detail: (installed, latest) => `实装 ${installed} → npm 最新 ${latest}。拿不准时先升级，再跑一遍 dsh-why。`,

    r5Title: (plugin) => `${plugin}：不在实测兼容矩阵中`,
    r5Detail: 'dsh-insights.com 未实测过该插件（未发布、太新或不在语料库）。本身不是问题 —— 以上本地检查仍然有效。',

    severity: { error: '错误', warning: '警告', info: '提示', note: '备注' },

    greenTitle: (n) => `全部健康 —— ${n} 个插件均可在当前 dsh 加载`,
    greenDetail: '所有启用插件的 client require 都能在当前 shell 模块表解析，声明的 dsh 版本范围也覆盖当前版本。',
    yellowTitle: (w) => `没有崩溃级问题，但有 ${w} 条警告值得关注`,
    redTitle: (e) => `发现 ${e} 个崩溃级问题`,

    issueTitle: 'issue 模板（复制到插件的 GitHub issue）：',
    issueHeading: '### dsh 插件加载失败 —— dsh-why 诊断报告',
    issueEnv: (dsh, shell, profile) => `- dsh：${dsh} · shell：${shell} · profile：${profile}`,
    issueTool: (v) => `- 诊断工具：dsh-why v${v}（https://github.com/ice5kysl/dsh-why）`,
    issuePlugin: (name, version) => `- 插件：${name}@${version ?? '未实装'}`,
    issueMissing: (specs) => `- 运行时缺失模块：${specs.map((s) => `\`${s}\``).join('、')}`,
    issueError: (spec) => `- 加载器报错：\`client-modules: require("${spec}") missed the module table\``,
    issueHistory: (line) => `- 模块历史：${line}`,
    issueFix: (fix) => `- 已知修法：${fix}`,
    issueAsk: '能否给这个 require 加 try/catch 兜底（加载器是调用时解析的），或换用当前 shell 模块表提供的模块？谢谢！',

    verdictText: {
      ok: '全部已发布 shell 均可加载',
      never: '从发布起在任何 shell 上都加载即崩',
      'broken-since': (since, okUntil) => `dsh >= ${since} 起崩（${okUntil} 及之前可用）`,
      'supported-since': (since) => `仅 dsh >= ${since} 可加载`,
      mixed: '各 shell 间反复横跳',
    },

    hintJson: '提示：--json 输出机器可读结果，--offline 完全不联网，--lang en 切换英文。',
  },
}

export function t(lang) {
  return dict[lang] ?? dict.en
}
