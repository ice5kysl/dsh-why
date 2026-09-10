/**
 * dsh-why web — page chrome strings (the report itself is localized by the
 * shared lib/i18n.mjs; these are the bits the page owns: headings, buttons,
 * the provenance note, the empty/bare/unrecognized states).
 *
 * @module dsh-why/web/strings
 */

const STR = {
  en: {
    title: 'dsh-why — why did your dsh break?',
    lede: 'Paste the red-screen error and get the same diagnosis the CLI gives — what the module is, when official dsh changed it, how many others hit it, and the fix. Nothing you paste leaves this browser.',
    commandTitle: 'Or run it locally (reads your actual install):',
    links: 'See also',
    pasteLabel: 'Paste the error text',
    pastePlaceholder: 'e.g. failed to import loader entry f059e6c1 (dsh-at-file): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table',
    versionLabel: 'Your dsh version',
    versionUnknown: 'Unknown (use newest known shell)',
    versionNote: 'the module table is baked into each shell build — pick the version you actually run for an accurate verdict',
    diagnose: 'Diagnose',
    paste: 'Paste',
    copy: 'Copy report',
    copying: 'Copied ✓',
    privacy: 'Privacy: the pasted text is diagnosed entirely in your browser and never uploaded. Data (module tables, known fixes, the compat matrix) is fetched from dsh-insights.com.',
    empty: 'Paste the loader error above — the red screen text or the console line starting with client-modules:.',
    bare: 'That red screen names no specific module or plugin, and this page cannot scan your machine. Run the CLI for a full local diagnosis:',
    bareCmd: 'npx dsh-why',
    unrecognizedTitle: 'Not recognized (yet)',
    unrecognized: 'This error shape is not in the pattern list — send it in so the library grows. Meanwhile the CLI may still help:',
    provenance: 'Web diagnosis — no local install was read. Graph rows come from the published per-shell roster (a superset of the real boot graph); your own plugins and profile are invisible here.',
    reportHeading: 'Diagnosis',
    loading: 'Diagnosing…',
    rowsFailed: 'the published row roster was unreachable, so unresolvable requires are reported as unclassified warnings, never as crashes.',
  },
  zh: {
    title: 'dsh-why —— 你的 dsh 为什么挂了？',
    lede: '粘贴红屏报错，得到与 CLI 相同的诊断——缺的是哪个模块、官方在哪一版改的、全生态多少人踩了同一个坑、怎么修。你粘贴的内容**不会离开这个浏览器**。',
    commandTitle: '或在本机运行（能读到你的真实安装）：',
    links: '另见',
    pasteLabel: '粘贴报错文本',
    pastePlaceholder: '例如：failed to import loader entry f059e6c1 (dsh-at-file): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table',
    versionLabel: '你的 dsh 版本',
    versionUnknown: '不知道（按最新已知 shell 判定）',
    versionNote: '模块表是烘焙进每个 shell 构建的——选你实际运行的版本，判定才准',
    diagnose: '诊断',
    paste: '粘贴',
    copy: '复制报告',
    copying: '已复制 ✓',
    privacy: '隐私：粘贴的内容全程在你的浏览器里诊断，绝不上传。数据（模块表、已知修法、兼容矩阵）取自 dsh-insights.com。',
    empty: '把上面的加载器报错粘进来——红屏文字或那段以 client-modules: 开头的控制台输出。',
    bare: '那段红屏没有指明具体的模块或插件，而这个网页无法扫描你的机器。要完整本机诊断请运行 CLI：',
    bareCmd: 'npx dsh-why',
    unrecognizedTitle: '暂不认识',
    unrecognized: '这个报错形态不在已支持列表里——发给我们扩充规则库。CLI 也许仍能帮上忙：',
    provenance: '网页诊断——未读取本机安装。图行清单来自观测站按 shell 版本发布的名册（是真实 boot graph 的超集）；你自己装的插件和 profile 在这里看不到。',
    reportHeading: '诊断结果',
    loading: '诊断中…',
    rowsFailed: '观测站的图行名册连不上，因此无法解析的 require 一律报「无法判定」警告，绝不误报崩溃。',
  },
}

export function webT(lang) {
  return STR[lang] ?? STR.en
}
