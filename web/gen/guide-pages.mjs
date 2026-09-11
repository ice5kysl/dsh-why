/**
 * dsh-why — the /guide/ page: what this is, when to reach for which command, and
 * how to put the plugin gate in CI.
 *
 * The site could already diagnose and already had an error reference, but nothing
 * explained the tool to someone who arrived from a search result on one error
 * page. This is that layer. Editorial content lives here (like RUN_PAGES) and the
 * page is built by web/gen/e.mjs, so the sitemap, llms.txt and the landing page's
 * reference index stay generated rather than hand-listed.
 *
 * @module dsh-why/web/guide-pages
 */

/** The two jobs, as the decision table the reader actually needs. */
export const GUIDE_SECTIONS = [
  {
    id: 'what',
    h2: ['What dsh-why is', 'dsh-why 是什么'],
    en: [
      `<p>dsh (DeepSeek Harness) has two ways to fail, and they leave completely different evidence behind. <strong>dsh-why answers both, from local files, read-only.</strong></p>`,
      `<ul class="rel">
        <li><code>npx dsh-why</code><span class="rel-note">dsh will not start. A plugin's client bundle called <code>require()</code> on a module the shell does not provide, and the loader materialized the whole client plugin tree — so one plugin takes every plugin down. dsh-why reads your actual install and names the plugin, the module, and the fix.</span></li>
        <li><code>npx dsh-why run</code><span class="rel-note">dsh starts fine, but a run died. The turn is over, you have a symptom, and nothing said why. dsh-why reads your own session logs and turns <code>turn/end.reason</code> into a verdict — plus a health view that separates chronic noise from a real incident.</span></li>
      </ul>`,
    ],
    zh: [
      `<p>dsh（DeepSeek Harness）有两种挂法,留下的证据完全不同。<strong>dsh-why 两种都答,全部基于本地文件、只读。</strong></p>`,
      `<ul class="rel">
        <li><code>npx dsh-why</code><span class="rel-note">dsh 起不来。某个插件的 client bundle <code>require()</code> 了 shell 不提供的模块,而加载器会物化整棵客户端插件树——所以一个插件能把所有插件一起拖下水。dsh-why 读取你真实的安装,点名是哪个插件、哪个模块、怎么修。</span></li>
        <li><code>npx dsh-why run</code><span class="rel-note">dsh 起得来,但某次 run 挂了。turn 已经结束,你手上只有一个现象,没人告诉你为什么。dsh-why 读取你自己的会话日志,把 <code>turn/end.reason</code> 变成判定——再给一个健康视图,把长期噪声和真正的「事件」分开。</span></li>
      </ul>`,
    ],
  },
  {
    id: 'when',
    h2: ['Which one do I run?', '我该跑哪一个？'],
    en: [
      `<table class="qtable"><thead><tr><th>What you see</th><th>Run this</th></tr></thead><tbody>
        <tr><td>dsh shows a red screen, a blank page, or will not boot</td><td><code>npx dsh-why</code></td></tr>
        <tr><td>A run stopped, errored, or never finished</td><td><code>npx dsh-why run</code></td></tr>
        <tr><td>You want to know whether your failures are normal</td><td><code>npx dsh-why run --all</code></td></tr>
        <tr><td>You are about to publish a plugin</td><td><code>npx dsh-why --package .</code></td></tr>
        <tr><td>You have an error string and no install handy</td><td>paste it into the box on the <a href="/">home page</a></td></tr>
      </tbody></table>`,
    ],
    zh: [
      `<table class="qtable"><thead><tr><th>你看到的现象</th><th>跑这个</th></tr></thead><tbody>
        <tr><td>dsh 红屏、白屏,或者根本起不来</td><td><code>npx dsh-why</code></td></tr>
        <tr><td>某次 run 停了、报错了,或者一直没结束</td><td><code>npx dsh-why run</code></td></tr>
        <tr><td>想知道自己的失败率算不算正常</td><td><code>npx dsh-why run --all</code></td></tr>
        <tr><td>马上要发布一个插件</td><td><code>npx dsh-why --package .</code></td></tr>
        <tr><td>手上只有一句报错,机器上没装 dsh</td><td>粘进<a href="/">首页</a>的输入框</td></tr>
      </tbody></table>`,
    ],
  },
  {
    id: 'verdicts',
    h2: ['The verdicts, and why some of them are deliberately vague', '判定档位,以及为什么有些档位故意说得很含糊'],
    en: [
      `<p>A diagnostic that guesses is worse than one that admits it does not know. Every dsh-why verdict lands on one of these, and <strong>a blind spot is never turned into a red card</strong>:</p>`,
      `<table class="qtable"><thead><tr><th>Verdict</th><th>Means</th></tr></thead><tbody>
        <tr><td><strong>crash</strong></td><td>The evidence is conclusive and something must change (exit <code>1</code>).</td></tr>
        <tr><td><strong>conditional</strong></td><td>The specifier is a built-in graph row: it usually resolves, the ordering is not guaranteed. Not a crash — declaring it in <code>dsh.client.external</code> makes it certain.</td></tr>
        <tr><td><strong>stopped by you</strong></td><td>A deliberate abort. Never a failure, never a red card.</td></tr>
        <tr><td><strong>unclassified</strong></td><td>dsh-why could not decide — the run was interrupted or the log is truncated, or a <code>--package</code> check read nothing. It says so, and never reports it as a pass (exit <code>3</code> for the gate).</td></tr>
      </tbody></table>`,
      `<p>That last row is the reason to trust the other three.</p>`,
    ],
    zh: [
      `<p>一个会猜的诊断工具,比一个承认自己不知道的更糟。dsh-why 的每个判定都落在这几档上,而且<strong>绝不把盲区变成红牌</strong>:</p>`,
      `<table class="qtable"><thead><tr><th>判定</th><th>含义</th></tr></thead><tbody>
        <tr><td><strong>crash</strong></td><td>证据确凿,必须改点什么(退出码 <code>1</code>)。</td></tr>
        <tr><td><strong>conditional</strong></td><td>该 specifier 是内置图行:通常能解析,但顺序不保证。不是崩溃——在 <code>dsh.client.external</code> 里声明它就变成确定的。</td></tr>
        <tr><td><strong>你主动停止</strong></td><td>主动中断。永远不算故障,永远不给红牌。</td></tr>
        <tr><td><strong>无法定性</strong></td><td>dsh-why 判不出来——run 被中断、日志被截断,或者 <code>--package</code> 什么都没读到。它会明说,绝不当作通过(门禁场景退出码 <code>3</code>)。</td></tr>
      </tbody></table>`,
      `<p>最后这一档,才是另外三档可信的理由。</p>`,
    ],
  },
  {
    id: 'runs',
    h2: ['What it can name when a run dies', 'run 挂掉时,它能定性的东西'],
    en: [
      `<p>The failure vocabulary is closed, which is what makes attribution possible at all. Across a measured corpus of 2,006 turns every failure carried one of these, and they split into two families that need <em>opposite</em> advice — the network family usually clears on its own, the configuration family never does:</p>`,
    ],
    zh: [
      `<p>失败词汇表是封闭的,而这是「能归因」这件事成立的前提。在一份 2,006 个 turn 的实测语料里,每一次失败都落在这几类上,而且分成两个需要<em>相反</em>建议的族——网络族通常会自己恢复,配置族永远不会:</p>`,
    ],
  },
  {
    id: 'authors',
    h2: ['If you publish a plugin', '如果你发布插件'],
    en: [
      `<p>dsh does not let your client bundle <code>require()</code> arbitrary npm packages — it resolves against a <strong>module table baked into each shell build</strong>. dsh ships several times a day. Nothing in your repo tells you when an upstream change would break yours, until your users do.</p>`,
      `<p><code>npx dsh-why --package .</code> is that check, and it works as a CI gate:</p>`,
      `<pre class="code"><code>npx dsh-why --package . &amp;&amp; npm publish   # any non-zero must block the release</code></pre>`,
      `<p>Exit <code>1</code> is a real crash. Exit <code>3</code> means it could not check at all — almost always an unbuilt checkout, since the client bundle is a build artifact. It is deliberately not <code>0</code>: a gate that passes when it verified nothing is worse than no gate.</p>`,
      `<p>Field-tested against 13 popular published plugins: <strong>zero false positives</strong>, and no plugin was found broken. This gate is quiet on healthy plugins — it is a regression guard against upstream, not a cleanup tool.</p>`,
      `<p><a href="https://github.com/ice5kysl/dsh-why/blob/main/docs/PLUGIN-AUTHOR-GATE.md">Full integration guide: CI recipes, exit codes, and the seed-safe fix pattern →</a></p>`,
    ],
    zh: [
      `<p>dsh 不允许你的 client bundle 任意 <code>require()</code> npm 包——它只对照<strong>烘焙进每个 shell 构建的模块表</strong>解析。而 dsh 每天要发好几次。你的仓库里没有任何东西会告诉你:上游的某次改动会不会打挂你的插件——直到你的用户先撞上。</p>`,
      `<p><code>npx dsh-why --package .</code> 就是这个检查,而且可以直接当 CI 门禁:</p>`,
      `<pre class="code"><code>npx dsh-why --package . &amp;&amp; npm publish   # 任何非 0 都必须拦住发版</code></pre>`,
      `<p>退出码 <code>1</code> 是真的崩溃。退出码 <code>3</code> 表示根本没检查成——几乎总是仓库还没构建,因为 client bundle 是构建产物。它故意不是 <code>0</code>:一个什么都没验证却给通过的门禁,比没有门禁更糟。</p>`,
      `<p>对 13 个热门已发布插件做过实测:<strong>零误报</strong>,且没有发现任何一个真的坏。这个门禁在健康插件上是安静的——它是防上游的回归护栏,不是清理工具。</p>`,
      `<p><a href="https://github.com/ice5kysl/dsh-why/blob/main/docs/PLUGIN-AUTHOR-GATE.md">完整接入指南:CI 写法、退出码、以及 seed-safe 修法 →</a></p>`,
    ],
  },
  {
    id: 'limits',
    h2: ['What it will never do', '它永远不会做的事'],
    en: [
      `<ul class="rel">
        <li>Never modifies a file.<span class="rel-note">It diagnoses. Fixing is yours, or your agent's — <code>--prompt</code> produces a paste-ready instruction.</span></li>
        <li>Never uploads anything.<span class="rel-note">No account, no telemetry, no session content leaves the machine. <code>--offline</code> skips even the read-only data fetches.</span></li>
        <li>Never calls a model.<span class="rel-note">Zero dependencies, no API key, no per-run cost. The whole rule base is local.</span></li>
        <li>Never turns "I could not tell" into a failure.<span class="rel-note">It reports it as unclassified and gives it a distinct exit code.</span></li>
      </ul>`,
    ],
    zh: [
      `<ul class="rel">
        <li>永远不修改任何文件。<span class="rel-note">它只做诊断。修是你的事,或者你的 agent 的事——<code>--prompt</code> 会产出一段可直接粘贴的指令。</span></li>
        <li>永远不上传任何东西。<span class="rel-note">没有账号、没有遥测,会话内容不离开本机。<code>--offline</code> 连只读的数据抓取都跳过。</span></li>
        <li>永远不调用模型。<span class="rel-note">零依赖、不需要 API key、没有按次成本。整套规则库都在本地。</span></li>
        <li>永远不把「我判不出来」变成失败。<span class="rel-note">它报成「无法定性」,并给出一个独立的退出码。</span></li>
      </ul>`,
    ],
  },
]

/** The CLI reference table — the same contract the --help text states. */
export const GUIDE_CLI = {
  rows: [
    ['npx dsh-why', 'diagnose the current install (loader failures)', '诊断当前安装(加载器失败)'],
    ['npx dsh-why run', 'attribute your latest run from its session log', '从会话日志给最近一次 run 定性'],
    ['npx dsh-why run --all', 'failure mix, your own baseline, and incident days', '失败构成、你自己的基线、异常日'],
    ['npx dsh-why --package .', 'plugin-author pre-publish gate', '插件作者发版门禁'],
    ['npx dsh-why --error "…"', 'diagnose a pasted error (or pipe via stdin)', '诊断粘贴的报错(或管道输入)'],
    ['npx dsh-why --offline', 'bundled rule base only, zero network', '仅用包内规则库,完全不联网'],
    ['npx dsh-why --json', 'machine-readable report (CI / an LLM)', '机器可读输出(CI / 喂给 LLM)'],
  ],
  exits: [
    ['0', 'nothing crash-level was found; for a run, no failed run in scope', '没有崩溃级问题;run 场景下范围内无失败'],
    ['1', 'a crash-level finding — something will break', '崩溃级问题——有东西会坏'],
    ['3', 'the check could not be performed (--package only)', '检查无法执行(仅 --package)'],
    ['2', 'usage error or an internal bug', '用法错误或内部 bug'],
  ],
}

/** Page-level copy, so the builder in e.mjs stays markup-only. */
export const GUIDE_HEAD = {
  slug: 'guide',
  title: 'dsh-why guide — what it diagnoses, when to run which command',
  description:
    'What dsh-why is: loader-failure diagnosis for DeepSeek Harness, run forensics from session logs, and a pre-publish gate for plugin authors. When to run which command, what each verdict means, and what it will never do.',
  h1: ['What dsh-why is, and when to use it', 'dsh-why 是什么,什么时候用它'],
  lead: [
    'Two ways dsh fails, two commands that answer them, and one rule that governs every answer: a blind spot is never turned into a red card.',
    'dsh 有两种挂法,两个命令分别回答,以及贯穿所有答案的一条原则:绝不把盲区变成红牌。',
  ],
}

export const GUIDE_LABELS = {
  cliTitle: ['CLI reference', 'CLI 参考'],
  cliCol: ['Command', '命令'],
  cliWhat: ['What it does', '作用'],
  exitTitle: ['Exit codes', '退出码'],
  exitCol: ['Code', '码'],
  exitWhat: ['Meaning', '含义'],
  loadersTitle: ['Loader failures — dsh will not start', '加载器失败 —— dsh 起不来'],
  runsTitle: ['Run failures — dsh started, a run died', '运行失败 —— dsh 起来了,某次 run 挂了'],
}
