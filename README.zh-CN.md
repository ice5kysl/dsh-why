# dsh-why

[![DSH Insights health](https://dsh-insights.com/badge/ice5kysl/dsh-why.svg)](https://dsh-insights.com/p/ice5kysl/dsh-why/)
[![npm](https://img.shields.io/npm/v/dsh-why.svg)](https://www.npmjs.com/package/dsh-why)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**我的 [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)（DeepSeek Harness）为什么挂了？** 零依赖、只读的 CLI 诊断工具：装了什么、什么崩了（或将崩）、为什么、怎么办——并对照 [dsh-insights.com](https://dsh-insights.com) 的全生态实测兼容矩阵。

```bash
npx dsh-why            # 诊断当前环境
npx dsh-why --json     # 机器可读（CI / 喂给 LLM）
npx dsh-why --offline  # 完全不联网，仅用包内规则库

# 手里攥着红屏报错？直接粘进来：
pbpaste | npx dsh-why                    # 管道输入自动识别
npx dsh-why --error "…missed the module table…"
npx dsh-why --prompt   # 末尾附可粘给 AI agent 的修复 prompt
```

Node ≥ 18，免安装（`npx` 即用），**零 npm 依赖**，**永远不修改你的任何文件**。输出语言按 locale 自动判断（中文/English），可用 `--lang zh|en` 覆盖。

## 它能告诉你什么

- **环境摘要**——dsh 版本、shell（模块表）版本、DSH_HOME、profile、插件数，以及本次判定所依赖的**图行模型**。「未找到 dsh 安装」也是合法答案，不是报错。
- **崩溃级结论（R1）**——插件 client bundle 里**无 try/catch 守卫**的 require 引用了当前 shell 模块表不提供的模块（守卫感知：被配对 `try/catch` 兜住的 require 不会崩——官方加载器是调用时解析的）。每个缺失模块都附**官方何时移除/何时加入/从未提供**——从已发布 shell 历史推导，不靠猜。
- **图行感知的四态判定**——loader 的 require 解析序是 seed 词 → 已物化模块 → **已注册工厂**：每个挂载的 `dsh.client` 包都会随 combo 批次注册一个按包名命名的工厂。dsh-why 直接读本机安装拿到图行清单（挂载集 = 内置 bundle 的 `cordis.patch.yml` 名册 ∩ 所有声明 `dsh.client` 的包），把每个 require 判为：
  - **可解析**（seed 词 / immediate 行 / 插件已在 `dsh.client.external`+`inject` 里声明的 lazy 行）；
  - **条件可解析**（**警告**）——未声明的 lazy 行：批次时序多半能解析，声明即变确定。**绝不翻红，也不进 issue 模板**；
  - **缺失**（**错误**）——本机安装里没有任何东西能解释它，才是崩溃级；
  - **无法判定**（**警告**）——本机安装树读不到，图行分支完全无法核对。报告会明确说出这一点并给出核实方法：工具绝不能把自己的盲区变成崩溃结论。
  后两态都不影响退出码；`--json` 的 `summary.conditional` / `summary.unclassified` 供 CI 区分两态。注释/字符串里的 require 字样、bundle 自带模块表的相对路径 require 都不会被误判为缺失。
- **版本范围警告（R2）**——插件声明的 `engines.dsh` 不覆盖你的 dsh。
- **profile 完整性（R6）**——manifest 声明了但 `node_modules` 里没有的插件会让 dsh 启动即炸（典型的「卸载插件后 dsh 起不来」）；磁盘上的半卸载残留给警告。pnpm symlink 会跟随验证，绝不误判。
- **报错粘贴模式（`--error` / 管道 stdin）**——直接解析加载器真实报错文本（`failed to import loader entry …`、`require("…") missed the module table`、`bundle script … failed to load`、`cannot resolve "…"`、裸 `Failed to load plugins` 退化为全量诊断），**即使本机没装该插件**也照常诊断。不认识的报错会诚实说明并列出已支持模式。
- **AI 修复 prompt（`--prompt`）**——末尾附可直接粘给 AI agent 的 prompt：环境 + 结论 + 已知修法 + seed-safe 约束（只允许模块表内 require，否则 try/catch）。
- **升级提示（R3）**——npm 上有新版；很多时候「先升级」就是全部修法。
- **生态对照（R4/R5）**——该插件在 [dsh-insights.com](https://dsh-insights.com) 实测矩阵里的判定（`ok` / `never` / `broken-since` / `supported-since`），以及「你不是唯一踩坑的：全生态 N 个插件缺同一个模块」。
- **可直接复制的 GitHub issue 模板**——环境信息和诊断结论已预填，发给插件作者即可。
- 全部健康时输出**绿色摘要**。

### 输出示例

```
✗ [错误·R1] fake-crash-plugin 在当前 dsh 上加载即崩
  现象：「Failed to load plugins」红屏 / require("@deepseek-ai/dsh-client-runtime/client")
  missed the module table —— 插件 client bundle 引用了 shell 模块表不提供的模块：
    - @deepseek-ai/dsh-client-runtime/client: 从未进入任何已发布 shell 的模块表
      —— 插件引用了一个 dsh 里根本不存在的模块
  修法（任选其一）：
    1. 移除插件让 dsh 先能启动：dsh plugin remove fake-crash-plugin
    2. 给插件作者提 issue —— 下方附可直接复制的模板
```

---

## 你大概是搜着这些报错来的

### `Failed to load plugins`

`dsh web` 启动时的红屏。某个启用插件的 client bundle 在加载器装配时抛了异常——绝大多数是缺模块（见下节）。跑 `npx dsh-why`：它会指出是哪个插件、缺哪个模块、官方哪一版改了模块表，以及你的修法（升插件 / 升或降 dsh / 移除插件）。

### `client-modules: require("...") missed the module table`

dsh 的 web shell 不允许插件 client bundle 任意 `require()` npm 包——require 只会对照**烘焙进 shell 构建产物的模块表**（`react`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`……）加上你其他已装插件注册的 client factory 解析。表外的引用在调用时抛这个错。

已知的官方断裂点（dsh-why 从 shell 历史实时推导）：

| dsh 版本 | 模块表变更 |
|---|---|
| `0.1.0-rc.8` | **移除** `@deepseek-ai/dsh-client-web-react`、`@deepseek-ai/dsh-client-ui-attachment`、`@deepseek-ai/dsh-client-schema-form` |
| `0.1.2-alpha.2` | **加入** `@deepseek-ai/dsh-client-store` |
| `0.1.5-alpha.1` | **加入** `@deepseek-ai/dsh-client-ui-dockkit` |
| *（从未）* | `@deepseek-ai/dsh-client-runtime/*` **从未**进入任何已发布 shell 的模块表 |

所以同一个插件在这版 dsh 能跑、那版就崩。`npx dsh-why` 告诉你站在线的哪一边——是插件作者该修（给 require 加 `try/catch` 兜底，加载器的调用时解析让它安全），还是你只需升/降 dsh。

### `client-modules: bundle script failed`

插件 client bundle 本身在加载器里执行/解析失败——构建层问题而非模块表缺失。dsh-why 仍然有用：确认插件的 require 是否可解析、`engines.dsh` 是否覆盖你的 dsh、生态矩阵是否测到过同样失败、npm 是否已有修复版。

### `client-modules: cannot resolve "..."`

「missed the module table」的异步 `import()` 版本——既不是 seed 词、未物化、也不在启动图里。诊断同上。

### 升级 dsh 后红屏

九成是 `0.1.0-rc.8` 式移除：插件引用的模块在新 shell 里没了。修法：`dsh plugin remove <插件名>` 先恢复启动；按 dsh-why 给出的版本号把 dsh 降回最后含该模块的 shell；或等插件适配后升级。如果 dsh-why 提示「该模块 dsh X 起才加入模块表」，方向相反——**你的 dsh 对这个插件太旧了**，升 dsh 即可。

---

## 工作原理（为什么可信）

1. **采集**（只读）：全局 dsh 安装（全局 npm root 下的 `@deepseek-ai/dsh` 与 shell 构建 `@deepseek-ai/dsh-web-frontend`）**连同它的客户端图行**（所有声明 `dsh.client` 的包 ∩ 内置 bundle 的 `cordis.patch.yml` 名册；immediate / lazy 取自各包自己的声明）、`DSH_HOME`（默认 `~/.dsh`）的 profile 清单（与 `dsh plugin add` 同一 seam）、每个启用插件的 client bundle。
2. **扫描** bundle 的字面量 `require("…")` 集合——**守卫感知**扫描器（花括号配对识别 `try{…}catch{…}`，跳过字符串/模板/注释/正则字面量）。这正是 dsh-insights.com 实测矩阵的同款代码，本地结论与线上生态数据同口径。
3. **规则库**：R1 模块表缺失（含逐模块历史）、R2 `engines.dsh` 覆盖、R3 npm 新版、R4/R5 对照实测矩阵（已观测 2300+ 插件）、R6 profile 完整性——外加 [fixes.json 案例库](https://dsh-insights.com/data/fixes.json)的已知修法。案例库同时**随包内置快照**：断网机器上「迁移到 `@deepseek-ai/dsh-client-store`」「声明 `dsh.client.external`」这类具体修法不会消失，报告会标明这份修法来自线上还是包内快照。修法与案例说明是中英双字段（`fix`/`fixEn`、`note`/`noteEn`），按 `--lang` 取用，缺英文时回落到中文原文而不是留空。
4. **优雅降级**：`--offline`（或网络不可达）回退到包内 shell 历史快照 **+ 案例库快照** + 本地规则库；安装树读不到时，把自己的判定降级为「无法判定」警告，而不是编造崩溃。环境区永远写明这次用的是哪种图行模型（`shell graph rows: 9 immediate + 37 lazy` / `scan-only` / `UNREADABLE`）——模型本身就是结论的一部分。诊断工具自己永远不能崩，也永远不能比它的输入更自信。

**隐私**：在线模式只发三类 GET 请求——dsh-insights.com 数据文件、npm registry 的 `latest` 元数据（仅限你已装的插件名）。你的机器信息永不上传，磁盘永不写入。

## CLI 参考

```
dsh-why [--json] [--offline] [--profile <name>] [--dsh-home <path>]
        [--lang zh|en] [--no-color] [--version] [--help]
```

| 参数 | 含义 |
|---|---|
| `--json` | 机器可读报告（findings 带结构化字段；含 `issueTemplate`） |
| `--offline` | 零网络——包内 shell 历史快照 + 本地规则 |
| `--profile <name>` | 诊断指定 profile（默认 `web`，或唯一的那个） |
| `--error [文本]` | 解析粘贴的报错文本（缺省读 stdin；管道输入自动识别），替代全量扫描 |
| `--prompt` | 末尾附可粘给 AI agent 的修复 prompt |
| `--dsh-home <path>` | 覆盖 `DSH_HOME`（也认环境变量 `DSH_HOME`） |
| `--lang zh\|en` | 输出语言（默认按 `LC_ALL`/`LANG`） |
| `--no-color` | 关闭颜色（认 `NO_COLOR` 环境变量） |

**退出码**：`0` 无崩溃级问题 · `1` 有崩溃级问题（可当 CI 门禁）· `2` 用法错误或内部 bug（请提 issue）。

非常规环境覆盖：`DSH_WHY_NPM_ROOT`（全局 npm 包所在目录）、`DSH_WHY_PROFILE`（profile 名）。

## 给插件作者

- 可选宿主模块请加守卫：`try { require("@deepseek-ai/dsh-client-store") } catch { /* 兜底 */ }`——加载器是调用时解析 require 的，配对的 catch 能把崩溃变成优雅降级。dsh-why 对被守卫的缺失只记备注，不算崩溃。
- 在 package.json 里声明 `engines.dsh` 并保持诚实。
- CI 发布前自检：`npx dsh-why --json`（有崩溃级问题时退出码为 1）。`--package <dir>` 自检模式欢迎 PR。

## 相关

- [dsh-insights.com](https://dsh-insights.com)——dsh 插件生态观测站（健康分、场景推荐、本工具对照的实测兼容矩阵）。数据源：[`/data/compat-observed.json`](https://dsh-insights.com/data/compat-observed.json)。
- [dsh-insights-kit](https://github.com/ice5kysl/dsh-insights-kit)——dsh 内的**事前**体检面板；dsh-why 是**事后**排障 CLI。
- [English README](./README.md)

## License

[MIT](./LICENSE) © ice5kysl
