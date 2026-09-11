/**
 * dsh-why — editorial copy for the run-failure topic pages.
 *
 * These are the eight failure classes `dsh-why run` can attribute, each with its
 * own page so the exact error string is a searchable, citable title. The slugs
 * here MUST match `FAILURE_CLASSES[].slug` in `lib/runrules.mjs` — the generator
 * asserts that both ways, because a slug drift silently produces a 404 from a
 * report the CLI already printed.
 *
 * Content rules, inherited from the startup pages:
 *   - the exact error string is the H1 and the title (that is what people search);
 *   - every claim is one the local forensics can actually back;
 *   - the answer to "is this my plugin's fault?" is stated explicitly, because that
 *     is the question that brings people here.
 *
 * @module dsh-why/web/run-pages
 */

const Q = (qEn, qZh, aEn, aZh) => ({ q: { en: qEn, zh: qZh }, a: { en: aEn, zh: aZh } })

/** The question every visitor is really asking, answered per class. */
const NOT_PLUGIN = {
  en: 'No. The turn failed between dsh and the provider — before, or instead of, a model reply. Plugins run inside dsh; none of them sits on the path to the API host. A failed plugin shows up as a load error at startup, not as a provider rejection.',
  zh: '不是。这个 turn 是在 dsh 与 provider 之间失败的——发生在模型回复之前，或取代了模型回复。插件跑在 dsh 里面，没有任何一个位于通往 API 主机的链路上。插件坏了会表现为启动时的加载错误，而不是 provider 的拒绝。',
}
const NOT_PLUGIN_LOCAL = {
  en: 'No. This is a local configuration state, not code. Nothing in your plugin set can set or unset a credential.',
  zh: '不是。这是本地配置状态，不是代码问题。你装的任何插件都无法设置或取消一个凭证。',
}

export const RUN_PAGES = [
  {
    slug: 'provider-transport',
    exact: 'DeepSeek API request to https://api.deepseek.com failed',
    title: 'dsh run failed: “DeepSeek API request … failed” — what it means',
    description:
      'The most common dsh run failure: the HTTP request to the provider never completed. What it means, why it is not your plugin, and how to get the run moving again.',
    lead: {
      en: 'The HTTP request from dsh to the model provider never completed. The turn ended with `{"kind":"error","code":"TRANSPORT"}`.',
      zh: 'dsh 发往模型 provider 的 HTTP 请求根本没有完成。turn 以 `{"kind":"error","code":"TRANSPORT"}` 结束。',
    },
    cause: {
      en: 'A network-path failure between your machine and the API host: a proxy or VPN that dropped the connection, DNS resolution, a TLS interception, or the endpoint being briefly unreachable. In a measured corpus of 2,006 turns this was 67 of 84 failures — 80% — spread over 15 days and 32 sessions, the signature of a chronic background condition rather than one outage.',
      zh: '你的机器与 API 主机之间的网络链路问题：代理或 VPN 断流、DNS 解析、TLS 拦截，或端点短暂不可达。在一份 2,006 个 turn 的实测语料里，84 次失败中有 67 次是这一类——80%——散布在 15 天、32 个会话，这是慢性背景问题而非单次故障的特征。',
    },
    fix: {
      en: [
        'Re-run the turn. This class is usually transient, and nothing local is left half-written when it fails before the first tool call.',
        'If it repeats, check the proxy/VPN path to the API host and whether DNS resolves it.',
        'Run `npx dsh-why` to confirm the local install itself is healthy and see which plugins are loaded.',
      ],
      zh: [
        '重跑这个 turn。这一类通常是暂时的；在首次工具调用前失败时，本地不会留下写了一半的东西。',
        '如果反复出现，检查到 API 主机的代理/VPN 链路，以及 DNS 能否解析它。',
        '跑 `npx dsh-why` 确认本地安装本身健康，并看清加载了哪些插件。',
      ],
    },
    plugin: NOT_PLUGIN,
    faq: [
      Q('Why do my dsh runs keep failing with an API request error?', '为什么我的 dsh run 反复报 API 请求失败？',
        'It is a network-path problem between dsh and the provider endpoint, not a plugin or model problem. `npx dsh-why run --all` shows whether it is chronic on your machine and how it compares to your own baseline.', '这是 dsh 与 provider 端点之间的网络链路问题，不是插件或模型的问题。`npx dsh-why run --all` 会告诉你它在你机器上是否属于长期问题、以及相对你自己基线如何。'),
      Q('Is this caused by an installed plugin?', '这是插件导致的吗？', NOT_PLUGIN.en, NOT_PLUGIN.zh),
      Q('How do I tell this apart from a provider outage?', '怎么和 provider 故障区分开？',
        'A transport failure is between you and the endpoint, so it tends to hit only your machine and to recur sporadically over days. A provider-side problem arrives as `provider-server` with an HTTP 5xx and usually correlates across users at the same time.', 'transport 失败发生在你与端点之间，所以它通常只影响你这台机器，并且会在多天里零星复现。provider 侧的问题会以 `provider-server` 加 HTTP 5xx 的形式出现，且通常在同一时间影响多个用户。'),
    ],
  },

  {
    slug: 'provider-auth-401',
    exact: '401: The API Key appears to be invalid or may have expired',
    title: 'dsh run failed: 401 “API Key appears to be invalid or may have expired”',
    description:
      'How to read a dsh 401 from the provider: which credential is wrong, where dsh reads it from, and how to replace it.',
    lead: {
      en: 'The provider rejected the request because the credential it received is not valid. The turn ended with `{"kind":"error","code":"AUTH"}`.',
      zh: 'provider 拒绝了请求，因为它收到的凭证无效。turn 以 `{"kind":"error","code":"AUTH"}` 结束。',
    },
    cause: {
      en: 'The key is expired, revoked, rotated, or belongs to a different provider route than the one the request went to. This class clusters in time around credential changes — and, in practice, around model switches, when the new model is served by a route the existing key does not cover.',
      zh: 'key 已过期、被撤销、已轮换，或属于与本次请求不同的 provider 路由。这一类会在凭证变更前后成簇出现——实践中也常出现在切模型时：新模型由一条现有 key 不覆盖的路由提供服务。',
    },
    fix: {
      en: [
        'Replace the key: the provider says this one is invalid or expired.',
        'Confirm which route the request used — `npx dsh-why` reports the credential route dsh resolved.',
        'If you recently switched models, switch back and re-run to confirm the key is the variable.',
      ],
      zh: [
        '换 key：provider 明确说这一个无效或已过期。',
        '确认请求走的是哪条路由——`npx dsh-why` 会报告 dsh 解析到的凭证路由。',
        '如果最近换过模型，先切回去重跑一次，确认变量就是这把 key。',
      ],
    },
    plugin: NOT_PLUGIN_LOCAL,
    faq: [
      Q('dsh worked yesterday and now returns 401 — what changed?', 'dsh 昨天还好好的，现在返回 401，改了什么？',
        'Either the key changed upstream, or the request started using a route the key does not cover. `npx dsh-why run --all` shows whether other failure classes started on the same day, which points at a configuration change rather than a network fault.', '要么 key 在上游变了，要么请求开始走一条 key 不覆盖的路由。`npx dsh-why run --all` 会显示同一天是否还有其他类别开始出现，那说明是配置变更而不是网络问题。'),
      Q('Where does dsh read the API key from?', 'dsh 从哪里读取 API key？',
        'From the credentials store the web client’s Models page writes, and from the environment dsh was booted with. `npx dsh-why` prints the route and the store involved.', '来自 web 客户端 Models 页面写入的凭证库，以及 dsh 启动时的环境变量。`npx dsh-why` 会打印相关路由与存储位置。'),
      Q('Is a 401 ever caused by a plugin?', '401 会是插件引起的吗？', NOT_PLUGIN_LOCAL.en, NOT_PLUGIN_LOCAL.zh),
    ],
  },

  {
    slug: 'provider-missing-credential',
    exact: 'llm-deepseek: no API key for provider route "deepseek-official"',
    title: 'dsh run failed: “no API key for provider route” — how to set it',
    description:
      'dsh found no credential for the provider route the request needed. Where the key must be stored, and why this is a configuration state rather than a plugin fault.',
    lead: {
      en: 'No credential is configured for the provider route this request needed. The turn ended with `{"kind":"error","code":"MISSING_CREDENTIAL"}`.',
      zh: '这次请求需要的 provider 路由没有配置任何凭证。turn 以 `{"kind":"error","code":"MISSING_CREDENTIAL"}` 结束。',
    },
    cause: {
      en: 'The route exists but nothing is stored for it: the key was never set, was set in an environment dsh did not inherit (a different shell, a container, a GUI launch), or the route name changed with a model update.',
      zh: '路由存在，但没有为它存任何东西：key 从未设置、设置在了 dsh 没有继承的环境里（另一个 shell、容器、GUI 启动），或路由名随模型更新而改变。',
    },
    fix: {
      en: [
        'Set the credential for the route named in the message — the message names the exact variable to store.',
        'Prefer the web client’s Models page: it writes the store dsh actually reads, rather than an environment only your current shell sees.',
        'If you launch dsh from a GUI or a service, make sure the variable is exported in that context too.',
      ],
      zh: [
        '为报错信息里点名的那条路由设置凭证——信息里写明了要存哪个变量。',
        '优先用 web 客户端的 Models 页面：它写入的是 dsh 真正读取的存储，而不是只有你当前 shell 才看得到的环境变量。',
        '如果从 GUI 或服务启动 dsh，确认那个上下文里也导出了该变量。',
      ],
    },
    plugin: NOT_PLUGIN_LOCAL,
    faq: [
      Q('I set the API key but dsh still says there is none', '我设了 API key，dsh 还是说没有',
        'The variable is almost certainly not reaching the process that runs dsh — a GUI launch, a container, or a different shell. Setting it through the web client’s Models page avoids that class of problem entirely.', '几乎可以确定是那个变量没有到达真正运行 dsh 的进程——GUI 启动、容器，或另一个 shell。通过 web 客户端的 Models 页面设置可以完全绕开这类问题。'),
      Q('What is a “provider route”?', '什么是「provider route」？',
        'A named endpoint-plus-credential pair in dsh’s model configuration. A key stored for one route does not apply to another, which is why adding a model can surface this error.', 'dsh 模型配置里一个「端点 + 凭证」的具名组合。为一个路由存的 key 不适用于另一个路由，这就是新增模型会暴露出这个错误的原因。'),
      Q('Is this the same as a 401?', '这和 401 是一回事吗？',
        'No. A 401 means a credential was sent and rejected; this one means no credential was found to send. The fixes differ: replace versus configure.', '不是。401 表示发了凭证但被拒绝；这一条表示压根没找到凭证可发。修法不同：一个是替换，一个是配置。'),
    ],
  },

  {
    slug: 'provider-quota',
    exact: 'Insufficient Balance',
    title: 'dsh run failed: “Insufficient Balance” — out of provider credit',
    description: 'The dsh turn ended with QUOTA: the provider rejected the request because the account has no remaining balance.',
    lead: {
      en: 'The provider refused the request because the account has insufficient balance. The turn ended with `{"kind":"error","code":"QUOTA"}`.',
      zh: 'provider 因账户余额不足拒绝了请求。turn 以 `{"kind":"error","code":"QUOTA"}` 结束。',
    },
    cause: {
      en: 'The account ran out of credit. It arrives without warning and looks identical to a transient failure, which is why `dsh-why run` separates it: re-running a quota failure will never succeed.',
      zh: '账户余额用尽。它来得毫无预兆，看起来和暂时性失败一模一样——这正是 `dsh-why run` 要把它单独分开的原因：余额不足的失败重跑多少次都不会成功。',
    },
    fix: {
      en: [
        'Top up the account, then re-run the turn.',
        'Until then, switch to a model served by a funded route — the failure will otherwise repeat exactly.',
        '`npx dsh-why run --all` shows how many turns this class covers, so you can see whether it is a one-off or the whole of today’s failures.',
      ],
      zh: [
        '给账户充值，然后重跑该 turn。',
        '在那之前，切到一个由有余额的路由提供的模型——否则这个失败会一字不差地重复。',
        '`npx dsh-why run --all` 会显示这一类覆盖了多少个 turn，便于判断是偶发还是今天全部的失败。',
      ],
    },
    plugin: NOT_PLUGIN_LOCAL,
    faq: [
      Q('Will retrying an “Insufficient Balance” failure work?', '「余额不足」的失败重试有用吗？',
        'No. Unlike a transport failure, this one is deterministic until the account is funded. Retrying only produces the same error.', '没用。和 transport 失败不同，在账户充值之前它是确定性的。重试只会得到同一个错误。'),
      Q('How do I tell QUOTA apart from a rate limit?', '怎么把 QUOTA 和限流区分开？',
        'A rate limit is a temporary throttle and usually names itself; insufficient balance is a billing state. dsh-why classifies on the provider’s own message, so the two never collapse into one bucket.', '限流是临时节流，通常会在信息里点名；余额不足是计费状态。dsh-why 按 provider 的原话分类，所以两者不会被混为一谈。'),
    ],
  },

  {
    slug: 'provider-pricing',
    exact: '503 "pricing not configured for provider/model"',
    title: 'dsh run failed: “pricing not configured for provider/model”',
    description:
      'A 503 that is not an outage: the provider has no pricing entry for the model route the request used. Common right after a model switch.',
    lead: {
      en: 'The provider returned 503 with “pricing not configured for provider/model”. Unlike a normal 5xx, this one is about configuration, not availability.',
      zh: 'provider 返回了 503 并附带「pricing not configured for provider/model」。与普通的 5xx 不同，这一条讲的是配置，不是可用性。',
    },
    cause: {
      en: 'The provider has no pricing entry for the model route the request used, so it refuses to serve it. This is the signature of a model switch: the route exists, but the billing metadata behind your key does not cover the new model. On a measured corpus this class appeared only on the single day a new model shipped, alongside auth and unsupported-model failures — 8 of 14 turns failed that day against a 3.7% baseline.',
      zh: 'provider 没有为本次请求使用的模型路由登记计价信息，因此拒绝服务。这是「切模型」的典型指纹：路由存在，但你这把 key 背后的计费元数据不覆盖新模型。在一份实测语料里，这一类只出现在新模型上线的那一天，并与 auth、unsupported model 的失败同时出现——那天 14 个 turn 里失败 8 个，而基线只有 3.7%。',
    },
    fix: {
      en: [
        'Pick a model whose route has pricing configured for this key, or complete the route’s configuration first.',
        'If you just switched models, switch back — that restores service immediately and confirms the cause.',
        'When several classes appear on the same day (auth, unsupported model, pricing), treat it as one configuration event, not three separate bugs.',
      ],
      zh: [
        '选一个这条 key 的路由已配置计价的模型，或先把该路由的配置补完。',
        '如果刚切过模型，先切回去——这能立刻恢复服务，也确认了原因。',
        '当同一天出现多个类别（auth、unsupported model、pricing）时，把它们当作一次配置事件，而不是三个独立的 bug。',
      ],
    },
    plugin: NOT_PLUGIN_LOCAL,
    faq: [
      Q('Is a 503 “pricing not configured” a provider outage?', '503「pricing not configured」是 provider 故障吗？',
        'No. An outage returns a generic 5xx that affects everyone; this returns a specific configuration message and affects the routes that lack pricing metadata.', '不是。故障返回的是影响所有人的通用 5xx；这一条返回的是明确的配置信息，影响的是缺计价元数据的那条路由。'),
      Q('Why did this start right after I changed models?', '为什么我刚换模型就开始报这个？',
        'The new model is served by a route your key’s billing configuration does not yet cover. dsh-why groups same-day failures so this shows up as one event instead of a mystery.', '新模型由一条你这把 key 的计费配置尚未覆盖的路由提供服务。dsh-why 会把同一天的失败归组，所以它会表现为一次事件，而不是一团谜。'),
    ],
  },

  {
    slug: 'model-unavailable',
    exact: '400 "unsupported model"',
    title: 'dsh run failed: 400 “unsupported model” — the route cannot serve it',
    description:
      'dsh asked for a model the provider route does not offer. What “unsupported model” means, and how it relates to a model switch.',
    lead: {
      en: 'The request named a model the provider route cannot serve. The turn ended with `{"kind":"error","code":"INVALID_REQUEST"}` and `400 "unsupported model"`.',
      zh: '请求点名了一个 provider 路由无法提供的模型。turn 以 `{"kind":"error","code":"INVALID_REQUEST"}` 和 `400 "unsupported model"` 结束。',
    },
    cause: {
      en: 'The model identifier is not offered by the endpoint your credential points at — a model that does not exist, one that is not enabled for this key, or one renamed or retired upstream. Like provider-pricing, it commonly appears the same day a model changes.',
      zh: '该模型标识不被你的凭证所指向的端点提供——模型不存在、未为此 key 启用，或在上游被改名/下线。和 provider-pricing 一样，它常与模型变更同日出现。',
    },
    fix: {
      en: [
        'Choose a model this key can serve; `400 unsupported model` means the route does not offer it.',
        'If you just switched, switch back or update the route before switching again.',
        'Run `npx dsh-why run --all` — if pricing and auth failures share the day, the model change is the single root.',
      ],
      zh: [
        '选一个这条 key 能服务的模型；`400 unsupported model` 表示路由不提供它。',
        '如果刚切过，先切回去，或先更新路由再切。',
        '跑 `npx dsh-why run --all`——如果 pricing 和 auth 的失败也在同一天，模型变更是唯一的根因。',
      ],
    },
    plugin: NOT_PLUGIN_LOCAL,
    faq: [
      Q('The model is in the composer list but the request says unsupported', '模型在 composer 列表里，但请求说不支持',
        'The composer list and the routes your credential can actually reach are different sets. The provider is the authority on the second one.', 'composer 列表与你的凭证实际能触达的路由是两个不同的集合。后者以 provider 为准。'),
      Q('Does this damage my session?', '这会损坏我的会话吗？',
        'No. The turn failed at request validation, before the model produced anything, so there is nothing to clean up. dsh-why reports whether any tool call had already run.', '不会。turn 在请求校验阶段就失败了，模型还没产出任何东西，所以没有需要清理的东西。dsh-why 会报告是否已有工具调用执行过。'),
    ],
  },

  {
    slug: 'provider-server',
    exact: '502 status code (no body)',
    title: 'dsh run failed: 502 “status code (no body)” from the provider',
    description: 'A provider-side 5xx ended the dsh turn. What it means, and why there is nothing local to fix.',
    lead: {
      en: 'The provider returned a server-side error with no body. The turn ended with `{"kind":"error","code":"SERVER"}`.',
      zh: 'provider 返回了一个没有响应体的服务端错误。turn 以 `{"kind":"error","code":"SERVER"}` 结束。',
    },
    cause: {
      en: 'Something failed upstream of your request — a gateway, an overloaded backend, or a transient routing fault. The empty body is itself the tell: the request never reached an application that could explain itself.',
      zh: '在你的请求的上游出了问题——网关、过载的后端，或一次临时的路由故障。空响应体本身就是线索：请求从未到达一个能解释自己的应用。',
    },
    fix: {
      en: [
        'Re-run the turn: a 5xx is upstream and usually clears on its own.',
        'If it persists, switch model from the composer and retry — that moves you to a different route.',
        '`npx dsh-why run --all` will tell you whether it is isolated or part of a wider event on the provider side.',
      ],
      zh: [
        '重跑这个 turn：5xx 来自上游，通常会自行恢复。',
        '如果持续，在 composer 里换个模型再试——这会把你换到另一条路由。',
        '`npx dsh-why run --all` 会告诉你它是孤立的，还是 provider 侧更大范围事件的一部分。',
      ],
    },
    plugin: NOT_PLUGIN,
    faq: [
      Q('Should I reinstall dsh or a plugin after a 502?', '遇到 502 需要重装 dsh 或插件吗？',
        'No. A 502 comes from the provider, and reinstalling local packages cannot change it. Check whether the failure is chronic on your machine before changing anything.', '不需要。502 来自 provider，重装本地包改变不了它。在动手之前，先确认这个失败在你机器上是否属于长期问题。'),
      Q('How is 502 different from the transport failure?', '502 和 transport 失败有什么区别？',
        'A transport failure never completes the HTTP exchange; a 502 completes it with an error status. The first is your network path, the second is upstream of the provider’s front door.', 'transport 失败根本没完成 HTTP 交换；502 则完成了交换并带回一个错误状态码。前者是你的网络链路，后者在 provider 前门的上游。'),
    ],
  },

  {
    slug: 'provider-timeout',
    exact: 'DeepSeek stream idle timeout after 300000ms',
    title: 'dsh run failed: “stream idle timeout” — the response stream stalled',
    description:
      'The model response stream went idle past the timeout and dsh ended the turn. When to retry, and when the turn was simply too heavy.',
    lead: {
      en: 'The response stream stopped producing data for longer than the configured idle timeout, so the turn was ended. The turn ended with `{"kind":"error","code":"TIMEOUT"}`.',
      zh: '响应流在超过配置的空闲超时后仍未产生数据，因此该 turn 被结束。turn 以 `{"kind":"error","code":"TIMEOUT"}` 结束。',
    },
    cause: {
      en: 'Either a transient stall on the provider or network path, or a turn that legitimately needed longer than the idle window — long tool-heavy turns and very large contexts are the usual candidates. The message names the window that elapsed.',
      zh: '要么是 provider 或网络链路的临时停滞，要么是这个 turn 确实需要比空闲窗口更长的时间——工具很多的长 turn 和超大上下文是常见候选。信息里写明了耗尽的窗口长度。',
    },
    fix: {
      en: [
        'Re-run the turn; a transient stall usually does not repeat.',
        'If the same heavy turn times out again, raise the idle timeout rather than retrying blindly — the work is fine, the window is too short.',
        'For turns with many tool calls, check `npx dsh-why run` for whether tool calls had already run, so you know what to redo.',
      ],
      zh: [
        '重跑这个 turn；临时停滞通常不会复现。',
        '如果同一个重 turn 再次超时，应该调大空闲超时，而不是盲目重试——活儿没问题，是窗口太短。',
        '对工具调用很多的 turn，用 `npx dsh-why run` 看是否已有工具执行过，从而知道哪些需要重做。',
      ],
    },
    plugin: NOT_PLUGIN,
    faq: [
      Q('Did my run lose work when it timed out?', '超时后我的 run 丢东西了吗？',
        'Whatever tool calls had already completed, completed. `npx dsh-why run` reports how many of the turn’s tool calls ran before it ended, so you know whether anything needs redoing or cleaning up.', '已经完成的工具调用就是完成了。`npx dsh-why run` 会报告这个 turn 结束前执行了多少次工具调用，你就知道是否需要重做或清理。'),
      Q('Is a stream idle timeout the same as a slow model?', '流空闲超时和模型慢是一回事吗？',
        'No. It measures silence on the stream, not total duration. A model that streams steadily for ten minutes will not trip it; one that goes quiet for the whole window will.', '不是。它衡量的是流上的静默，而不是总时长。稳定输出十分钟的模型不会触发它；沉默满一个窗口的会。'),
    ],
  },
]

/**
 * Short human label per class, and its related classes.
 *
 * The grouping is measured, not guessed. Across a 2,006-turn corpus the failures
 * split into two families that need opposite advice:
 *
 *   network family       transport 67 + server 3 + timeout 2 = 72 of 84
 *                        → waiting and retrying is correct
 *   configuration family auth 3 + missing-credential 3 + pricing 2
 *                        + model-unavailable 2 + quota 2 = 12 of 84
 *                        → retrying can never help; something must be configured
 *
 * Within a family the classes are also the ones users confuse: 401 versus "no key
 * found" (nothing was sent versus what was sent was rejected), and 502 versus
 * transport (the exchange completed versus never did). Those distinctions are
 * already spelled out in each page's FAQ, so linking them is the natural next
 * click rather than padding.
 */
const LABELS = {
  'provider-transport': { en: 'the API call never completed', zh: 'API 请求根本没完成' },
  'provider-auth-401': { en: 'the key was rejected', zh: 'key 被拒绝' },
  'provider-missing-credential': { en: 'no key for this route', zh: '这条路由没配 key' },
  'provider-quota': { en: 'out of credit', zh: '余额不足' },
  'provider-pricing': { en: 'no pricing for this model', zh: '这个模型没配计价' },
  'model-unavailable': { en: 'the route cannot serve it', zh: '路由不提供这个模型' },
  'provider-server': { en: 'a 5xx from the provider', zh: 'provider 返回 5xx' },
  'provider-timeout': { en: 'the stream went idle', zh: '响应流空闲超时' },
}

const RELATED = {
  'provider-transport': ['provider-server', 'provider-timeout'],
  'provider-server': ['provider-transport', 'provider-timeout'],
  'provider-timeout': ['provider-transport', 'provider-server'],
  'provider-auth-401': ['provider-missing-credential', 'provider-pricing'],
  'provider-missing-credential': ['provider-auth-401', 'provider-pricing'],
  'provider-pricing': ['model-unavailable', 'provider-auth-401'],
  'model-unavailable': ['provider-pricing', 'provider-auth-401'],
  'provider-quota': ['provider-pricing', 'provider-auth-401'],
}

for (const page of RUN_PAGES) {
  page.label = LABELS[page.slug]
  page.related = RELATED[page.slug] ?? []
}
