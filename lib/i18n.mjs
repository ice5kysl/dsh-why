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
    envRowsExact: (immediate, lazy) => `shell graph rows: ${immediate} immediate + ${lazy} lazy (mounted-set read from the local install)`,
    envRowsScanOnly: (n) => `shell graph rows: ${n} client package(s) found in the install, but the mounted-set filter was unreadable — a few unmounted alternates may then be called conditional instead of missing`,
    envRowsUnavailable: 'shell graph rows: UNREADABLE — the loader branch that resolves built-in rows cannot be checked, so requires this shell does not explain are reported as UNCLASSIFIED warnings, never as crashes (point DSH_WHY_NPM_ROOT at the global npm root of your dsh install to settle it)',

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
    r1CondTitle: (plugin) => `${plugin}: resolves only conditionally on this dsh`,
    r1CondDetail: (specs) => `requires shell built-in graph row(s): ${specs.join(', ')} — not seed words, but their bundles register factories when their combo batch executes; usually resolves, ordering not guaranteed.`,
    r1CondFix: 'Fix: declare them in the plugin’s dsh.client.external (or inject) — the loader then arrives them before the plugin materializes, and conditional becomes certain.',
    r1NowConditional: 'note: this module is a built-in graph ROW of the current shell — it usually resolves (batch timing); the pasted error is timing-dependent, not a hard incompatibility',
    r1NowUnknown: 'note: this module is not a seed word of the current shell, and the shell’s graph rows could not be read — whether it resolves here could NOT be verified',
    r1TitleErrorUnknown: 'the module in the pasted error could not be classified on this shell',
    r1SymptomUnverified: (missing) => `the pasted error says require("${missing[0]}") missed the module table — that build is resolvable here only if your install mounts a row for it, which could not be checked:`,
    r1UnknownTitle: (plugin) => `${plugin}: require(s) could not be classified on this dsh`,
    r1UnknownDetail: (specs) => `cannot decide require(${specs.map((spec) => `"${spec}"`).join(', ')}) — not a seed word of this shell, and the shell’s graph rows were unreadable, so "built-in row that resolves by batch timing" and "module this dsh does not provide" are indistinguishable here.`,
    r1UnknownFix: 'not a crash verdict: re-run with DSH_WHY_NPM_ROOT pointing at the global npm root of your dsh install (or drop --offline) to classify them — the module history above shows which side they would land on.',
    r1NextStepTitle: 'Next step:',
    summaryConditional: (n) => `${n} conditional require(s) (built-in graph rows, timing-dependent)`,
    summaryUnclassified: (n) => `${n} unclassified require(s) (shell graph rows unreadable)`,
    r4AtShellConditional: 'measured CONDITIONAL at your shell (built-in graph row, timing-dependent — declaring dsh.client.external makes it deterministic)',

    r2Title: (plugin) => `${plugin}: declared dsh range does not cover your dsh`,
    r2Detail: (range, v) => `engines.dsh is "${range}" but the installed dsh is ${v}. The plugin may rely on APIs your dsh does not have (or no longer has).`,
    r2Undecidable: (range) => `engines.dsh "${range}" could not be evaluated (unusual range syntax) — check it by hand.`,
    r2Fix: (name) => `check ${name}’s releases for a build declaring support for your dsh, or pin dsh to a covered version.`,

    r3Title: (plugin) => `${plugin}: a newer release exists`,
    r3Detail: (installed, latest) => `installed ${installed} → npm latest ${latest}. When in doubt, upgrade first and re-run dsh-why.`,

    r5Title: (plugin) => `${plugin}: not in the observed-compat matrix`,
    r5Detail: 'This plugin was not measured by dsh-insights.com (unpublished, too new, or outside the corpus). Not a problem by itself — local checks above still apply.',

    r6MissingTitle: (plugin) => `${plugin}: declared in the profile manifest but missing from node_modules`,
    r6MissingDetail: 'dsh tries to load every enabled bundle at boot — a missing directory crashes the startup (the classic "uninstalled a plugin and now dsh won\'t come up"). Usually a failed or half-finished install/uninstall.',
    r6MissingFixReinstall: (name) => `reinstall it: dsh plugin add ${name} (or run the profile's package manager again, e.g. pnpm install)`,
    r6MissingFixRemove: (name) => `or remove it from the manifest: dsh plugin remove ${name}`,
    r6DisabledMissing: (plugin) => `${plugin}: declared but not in the load list, and its files are gone — a stale manifest entry; clean it with dsh plugin remove ${plugin}`,
    r6LeftoverTitle: (plugin) => `${plugin}: present in node_modules but declared nowhere in the manifest`,
    r6LeftoverDetail: 'looks like uninstall residue — safe to delete the directory (if another plugin depends on it, ignore this note).',

    errTitle: 'Parsed error',
    errPlugins: (names) => `plugin reference(s): ${names.join(', ')}`,
    errModules: (mods) => `module reference(s): ${mods.join(', ')}`,
    errNotInstalledNote: 'diagnosing the referenced objects themselves — the plugin may not be installed on this machine at all',
    errBareFallback: 'The error names no specific plugin — running the full environment diagnosis instead.',
    errUnknown: 'I don’t recognize this error pattern (yet).',
    errUnknownPatterns: 'Patterns I can parse:',
    errUnknownAdvice: 'Generic steps: 1) run npx dsh-why for a full diagnosis of this machine; 2) look the plugin up on https://dsh-insights.com; 3) try upgrading or downgrading dsh.',
    errUnknownCta: 'Send us the full error text to grow the pattern library: https://github.com/ice5kysl/dsh-why/issues',
    errNoCrash: 'The pasted error does not constitute a crash-level problem on this environment (see the per-reference lines above).',
    r1TitleError: 'the module in the pasted error is not resolvable on this shell',
    r1NowResolved: 'note: this module IS in the current shell’s module table — the pasted error likely came from an older dsh; an upgrade already fixed it',
    r4ErrorTitle: (plugin) => `${plugin}: the ecosystem matrix on the pasted error`,
    r4AtShellBroken: (missing) => `measured broken at your shell — missing: ${missing.join(', ')}`,
    r4AtShellOk: 'measured OK at your shell — the pasted error likely predates a fix (check versions)',

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

    promptTitle: 'AI fix prompt (paste straight to your agent):',
    promptNone: 'Nothing to fix — all clear, no prompt needed.',
    promptHeader: '# Fix a dsh (DeepSeek Harness) plugin load failure',
    promptFindingsLabel: '## Diagnosis (from dsh-why)',
    promptFixesLabel: '## Known fixes (ecosystem case base)',
    promptConstraintsLabel: '## Constraints',
    promptConstraintSeedSafe: (version, words) => `- seed-safe only: the client bundle may require() ONLY modules in the current shell's module table (shell ${version}): ${words.join(', ')} — anything else MUST be wrapped in try/catch (the loader resolves require() at call time, so a paired catch turns the crash into a graceful fallback)`,
    promptConstraintScope: '- do not touch dsh itself, other plugins, or files outside the plugin you are fixing',
    promptConstraintVerify: '- when done, verify with `npx dsh-why` — it must come back all-clear',

    verdictText: {
      ok: 'loads on every published shell',
      never: 'never loaded on ANY published shell (broken since its first release)',
      'broken-since': (since, okUntil) => `breaks on dsh >= ${since} (worked up to ${okUntil})`,
      'supported-since': (since) => `only loads on dsh >= ${since}`,
      conditional: 'no broken shell, but conditionally resolvable on some versions (built-in graph-row timing)',
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
    envRowsExact: (immediate, lazy) => `shell 图行：${immediate} 个 immediate + ${lazy} 个 lazy（挂载集读自本机安装）`,
    envRowsScanOnly: (n) => `shell 图行：安装里扫到 ${n} 个带 client 的包，但「挂载集」过滤器读不到——少数未挂载的同名替代包可能被判成条件可解析而非缺失`,
    envRowsUnavailable: 'shell 图行：读不到 —— 加载器解析内置图行的那条分支无法核对，因此本 shell 解释不了的 require 一律报「无法判定」警告，绝不报崩溃（把 DSH_WHY_NPM_ROOT 指向你 dsh 全局安装的 npm root 即可判定）',

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
    r1CondTitle: (plugin) => `${plugin}：在当前 dsh 上仅条件可解析`,
    r1CondDetail: (specs) => `引用了 shell 内置图行：${specs.join('、')}——不是 seed 词，但其 bundle 随组合批次执行时会注册工厂；实践中多半能解析，但时序无保证。`,
    r1CondFix: '修法：在插件的 dsh.client.external（或 inject）里声明它们——加载器会在插件物化前先到达这些行，条件变确定。',
    r1NowConditional: '注意：该模块是当前 shell 的内置图行——实践中多半可解析（批次时序），报错是时序敏感而非硬不兼容',
    r1NowUnknown: '注意：该模块不是当前 shell 的 seed 词，而本机 shell 的图行清单读不到——**无法验证**它在此处是否可解析',
    r1TitleErrorUnknown: '报错中的模块在当前 shell 上无法判定',
    r1SymptomUnverified: (missing) => `报错称 require("${missing[0]}") missed the module table —— 该构建在这里能否解析，取决于你的安装是否挂载了对应图行，而这一点读不到：`,
    r1UnknownTitle: (plugin) => `${plugin}：在当前 dsh 上有 require 无法判定`,
    r1UnknownDetail: (specs) => `无法判定 require(${specs.map((spec) => `"${spec}"`).join('、')})——它不是当前 shell 的 seed 词，而本机 shell 的图行清单读不到，因此「内置图行、按批次时序可解析」与「当前 dsh 不提供的模块」在这里是区分不开的。`,
    r1UnknownFix: '这不是崩溃判定：把 DSH_WHY_NPM_ROOT 指向你 dsh 全局安装的 npm root（或去掉 --offline）重跑即可判定——上方模块历史能看出它们会落到哪一侧。',
    r1NextStepTitle: '下一步：',
    summaryConditional: (n) => `${n} 处条件可解析 require（内置图行，时序敏感）`,
    summaryUnclassified: (n) => `${n} 处无法判定 require（shell 图行清单读不到）`,
    r4AtShellConditional: '实测在你的 shell 上「条件可解析」（内置图行，时序敏感——声明 dsh.client.external 可获确定性）',

    r2Title: (plugin) => `${plugin}：声明的 dsh 版本范围不覆盖你的 dsh`,
    r2Detail: (range, v) => `engines.dsh 声明为「${range}」，而当前 dsh 是 ${v}。插件可能依赖你的 dsh 还没有（或已移除）的 API。`,
    r2Undecidable: (range) => `engines.dsh「${range}」无法解析（非常规写法）—— 请人工核对。`,
    r2Fix: (name) => `看看 ${name} 是否有声明支持你当前 dsh 的新版本，或把 dsh 固定在覆盖范围内。`,

    r3Title: (plugin) => `${plugin}：有新版本可升`,
    r3Detail: (installed, latest) => `实装 ${installed} → npm 最新 ${latest}。拿不准时先升级，再跑一遍 dsh-why。`,

    r5Title: (plugin) => `${plugin}：不在实测兼容矩阵中`,
    r5Detail: 'dsh-insights.com 未实测过该插件（未发布、太新或不在语料库）。本身不是问题 —— 以上本地检查仍然有效。',

    r6MissingTitle: (plugin) => `${plugin}：manifest 声明了，但 node_modules 里没有`,
    r6MissingDetail: 'dsh 启动时会加载每个启用的 bundle——目录缺失直接炸启动（典型的「卸载插件后 dsh 起不来」）。多半是装/卸中途失败。',
    r6MissingFixReinstall: (name) => `重装：dsh plugin add ${name}（或在 profile 目录里重跑 pnpm install）`,
    r6MissingFixRemove: (name) => `或从清单移除：dsh plugin remove ${name}`,
    r6DisabledMissing: (plugin) => `${plugin}：已声明但未启用，且文件已不在——清单残留，用 dsh plugin remove ${plugin} 清理`,
    r6LeftoverTitle: (plugin) => `${plugin}：node_modules 里存在，但 manifest 没有任何声明`,
    r6LeftoverDetail: '疑似卸载残留——可安全删除该目录（若是被其他插件当依赖拖进来的，忽略本条）。',

    errTitle: '报错解析',
    errPlugins: (names) => `识别到插件：${names.join('、')}`,
    errModules: (mods) => `识别到模块：${mods.join('、')}`,
    errNotInstalledNote: '按报错对象本身诊断——该插件可能根本没装在本机上',
    errBareFallback: '报错未指明具体插件——已退化为全量诊断。',
    errUnknown: '暂不认识这个报错模式。',
    errUnknownPatterns: '已支持的模式：',
    errUnknownAdvice: '通用排查：1) 跑 npx dsh-why 全量诊断本机；2) 上 https://dsh-insights.com 查该插件详情页；3) 试试升/降 dsh 版本。',
    errUnknownCta: '把完整报错发给我们扩充规则库：https://github.com/ice5kysl/dsh-why/issues',
    errNoCrash: '该报错在当前环境下不构成崩溃级问题（见上方逐条对照）。',
    r1TitleError: '报错中的模块在当前 shell 上不可解析',
    r1NowResolved: '注意：该模块在当前 shell 模块表内可解析——报错多半来自旧版 dsh，升级后已自愈',
    r4ErrorTitle: (plugin) => `${plugin}：生态实测矩阵对该报错的结论`,
    r4AtShellBroken: (missing) => `实测在你的 shell 上崩——缺：${missing.join('、')}`,
    r4AtShellOk: '实测在你的 shell 上可加载——报错多半来自修复前的旧版本（核对版本）',

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

    promptTitle: 'AI 修复 prompt（直接粘给你的 agent）：',
    promptNone: '没有需要修复的问题——全绿，无需 prompt。',
    promptHeader: '# 修复 dsh（DeepSeek Harness）插件加载失败',
    promptFindingsLabel: '## 诊断结论（来自 dsh-why）',
    promptFixesLabel: '## 已知修法（生态案例库）',
    promptConstraintsLabel: '## 约束（必须遵守）',
    promptConstraintSeedSafe: (version, words) => `- seed-safe：client bundle 只允许 require 当前 shell 模块表（shell ${version}）内的模块：${words.join('、')}——表外模块一律 try/catch 兜底（加载器调用时解析 require，配对的 catch 能把崩溃变成优雅降级）`,
    promptConstraintScope: '- 不要改 dsh 本体、其他插件、或待修插件源码之外的任何文件',
    promptConstraintVerify: '- 改完运行 `npx dsh-why` 验证：必须输出全绿',

    verdictText: {
      ok: '全部已发布 shell 均可加载',
      never: '从发布起在任何 shell 上都加载即崩',
      'broken-since': (since, okUntil) => `dsh >= ${since} 起崩（${okUntil} 及之前可用）`,
      'supported-since': (since) => `仅 dsh >= ${since} 可加载`,
      conditional: '无崩溃版本，但部分版本为条件可解析（内置图行批次时序）',
      mixed: '各 shell 间反复横跳',
    },

    hintJson: '提示：--json 输出机器可读结果，--offline 完全不联网，--lang en 切换英文。',
  },
}

export function t(lang) {
  return dict[lang] ?? dict.en
}
