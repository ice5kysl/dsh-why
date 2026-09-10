# dsh-why

[![DSH Insights health](https://dsh-insights.com/badge/ice5kysl/dsh-why.svg)](https://dsh-insights.com/p/ice5kysl/dsh-why/)
[![npm](https://img.shields.io/npm/v/dsh-why.svg)](https://www.npmjs.com/package/dsh-why)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Why did my [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) (DeepSeek Harness) break?** A zero-dependency, read-only CLI that diagnoses plugin load failures: what you have installed, what crashes (or will crash) the loader, why, and how to fix it — cross-checked against the ecosystem-wide observed-compatibility matrix at [dsh-insights.com](https://dsh-insights.com).

```bash
npx dsh-why            # diagnose the current environment
npx dsh-why --json     # machine-readable (CI / paste to an LLM)
npx dsh-why --offline  # zero network, bundled rule base only

# holding a red-screen error? paste it straight in:
pbpaste | npx dsh-why                    # piped stdin is auto-detected
npx dsh-why --error "…missed the module table…"
npx dsh-why --prompt   # append a paste-ready fix prompt for your AI agent
```

Node ≥ 18, no install required (`npx`), **zero npm dependencies**, and it **never modifies any file** on your machine. Output language follows your locale (中文/English), override with `--lang zh|en`.

## What it tells you

- **Environment summary** — dsh version, shell (module-table) version, DSH_HOME, profile, plugin count, and which **row model** the verdicts rest on. "No dsh installation found" is a valid answer, not an error.
- **Crash-level findings (R1)** — a plugin whose client bundle requires a module the current shell's module table doesn't provide, *unguarded* (the try/catch-aware check: requires covered by a paired `try/catch` don't crash — the loader resolves `require()` at call time). For each missing module: **when official dsh removed it, or added it, or never shipped it** — derived from the published shell history, not guesswork.
- **Graph-row aware, four-way verdicts** — the loader resolves `require()` via seed words → materialized modules → **registered factories**: every mounted `dsh.client` package registers a factory under its package name when its combo batch executes. dsh-why reads those rows from your local install (mounted set = the in-box bundles' `cordis.patch.yml` roster ∩ every `dsh.client` package) and classifies each require as:
  - *resolvable* (seed word / immediate row / a lazy row the plugin declares in `dsh.client.external`+`inject`),
  - *conditional* — **warning**: an undeclared lazy row; it usually resolves by batch timing, and declaring it makes it deterministic. **Never a red card, never in the issue template.**
  - *missing* — **error**: nothing in this install can answer it (the crash class),
  - *unclassified* — **warning**: your install tree was unreadable, so the row branch could not be checked at all. The report says so loudly and tells you how to settle it — a tool must never turn its own blind spot into a crash verdict.
  Conditional and unclassified both stay out of the exit code; `summary.conditional` / `summary.unclassified` in `--json` tell them apart for CI. Comments/strings and bundle-local relative requires are never misread as missing modules.
- **Version-range warnings (R2)** — the plugin's `engines.dsh` doesn't cover your dsh.
- **Profile integrity (R6)** — a plugin declared in the manifest but missing from `node_modules` crashes dsh at boot (the classic "uninstalled a plugin and now it won't start"); half-uninstalled leftovers on disk get a warning. pnpm symlinks are followed, never misflagged.
- **Pasted-error mode (`--error` / piped stdin)** — parses the loader's actual error text (`failed to import loader entry …`, `require("…") missed the module table`, `bundle script … failed to load`, `cannot resolve "…"`, bare `Failed to load plugins` → full diagnosis) and diagnoses the referenced plugin/module even when it is NOT installed locally. Unknown patterns get an honest "not recognized" plus the supported list.
- **AI fix prompt (`--prompt`)** — appends a paste-ready prompt for your coding agent: environment + findings + known fixes + the seed-safe constraint (only module-table requires, or try/catch).
- **Upgrade hints (R3)** — a newer release exists on npm; upgrading first is often the whole fix.
- **Ecosystem cross-check (R4/R5)** — the plugin's measured verdict on [dsh-insights.com](https://dsh-insights.com) (`ok` / `never` / `broken-since` / `supported-since`), plus *"you are not alone: N plugins ecosystem-wide miss the same module."*
- **A copy-ready GitHub issue template** for the plugin author, with your environment and the diagnosis pre-filled.
- **A green "all clear"** when everything loads fine.

### Sample output

```
✗ [ERROR·R1] fake-crash-plugin crashes the loader on this dsh
  Symptom: "Failed to load plugins" / require("@deepseek-ai/dsh-client-runtime/client")
  missed the module table — the client bundle requires module(s) the shell does not provide:
    - @deepseek-ai/dsh-client-runtime/client: never shipped in ANY published shell's
      module table — the plugin was written against a module that does not exist in dsh
  How to fix (pick one):
    1. remove the plugin to get dsh booting again: dsh plugin remove fake-crash-plugin
    2. report it to the plugin author — a copy-ready issue template is attached below
```

---

## Hitting one of these errors? This is what they mean

### `Failed to load plugins`

The red screen when `dsh web` boots. One of your enabled plugins' client bundles threw while the loader was materializing it — almost always a missing module (next section). Run `npx dsh-why`: it names the plugin, the missing module, when official dsh changed the module table, and your fix options (upgrade the plugin / upgrade or downgrade dsh / remove the plugin).

### `client-modules: require("...") missed the module table`

dsh's web shell doesn't let plugin client bundles `require()` arbitrary npm packages — it resolves requires against a **module table baked into the shell build** (`react`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, …) plus the registered client factories of your other installed plugins. Anything else throws this error at call time.

Known official breaking points (dsh-why derives these live from the shell history):

| dsh release | module-table change |
|---|---|
| `0.1.0-rc.8` | **removed** `@deepseek-ai/dsh-client-web-react`, `@deepseek-ai/dsh-client-ui-attachment`, `@deepseek-ai/dsh-client-schema-form` |
| `0.1.2-alpha.2` | **added** `@deepseek-ai/dsh-client-store` |
| `0.1.5-alpha.1` | **added** `@deepseek-ai/dsh-client-ui-dockkit` |
| *(never)* | `@deepseek-ai/dsh-client-runtime/*` was **never** in any published shell's module table |

So the same plugin can load on one dsh and crash on another. `npx dsh-why` tells you which side of the line you're on — and whether the plugin author can fix it (guard the require with `try/catch`, which the loader's call-time resolution makes safe) or you just need a newer/older dsh.

### `client-modules: bundle script failed`

The plugin's client bundle itself failed to execute or parse in the loader — a build-level problem rather than a module-table miss. dsh-why still helps: it confirms whether the plugin's requires are satisfiable, whether its `engines.dsh` covers your dsh, whether the ecosystem matrix measured the same failure, and whether a newer plugin release exists.

### `client-modules: cannot resolve "..."`

The async `import()` twin of "missed the module table" — the specifier isn't a seed word, not materialized, and not in the boot graph. Same diagnosis applies.

### Red screen after upgrading dsh

Almost always a `0.1.0-rc.8`-style removal: your plugin was written against a module the new shell no longer provides. Options: `dsh plugin remove <name>` to get booting, downgrade dsh to the last shell that had the module (dsh-why names the exact version), or upgrade the plugin if the author already adapted. When dsh-why reports *"only added to the module table in dsh X"*, it's the opposite direction — **your dsh is too old for the plugin**; upgrade dsh.

---

## How it works (and why you can trust it)

1. **Collects** (read-only): your global dsh install (`@deepseek-ai/dsh` + the `@deepseek-ai/dsh-web-frontend` shell build under the global npm root) **including its client graph rows** (every `dsh.client` package, intersected with the in-box bundles' `cordis.patch.yml` roster — `immediate` vs `lazy` from each package's own flag), your `DSH_HOME` (default `~/.dsh`) profile manifest — the same seam `dsh plugin add` operates on — and each enabled plugin's client bundle.
2. **Scans** each bundle's literal `require("…")` set with a **guard-aware** scanner (brace-matched `try{…}catch{…}` pairing that skips strings/templates/comments/regex literals) — the exact code that powers the dsh-insights.com observed-compat matrix, so your local diagnosis agrees with the published ecosystem data.
3. **Checks the rule base**: R1 module-table misses with per-module history, R2 `engines.dsh` coverage, R3 npm upgrades, R4/R5 ecosystem cross-check against the live matrix (2,300+ plugins observed), R6 profile integrity — plus known fixes from the [fixes.json case base](https://dsh-insights.com/data/fixes.json). The case base ships as a **bundled snapshot** too, so the concrete recipe ("migrate to `@deepseek-ai/dsh-client-store`", "declare `dsh.client.external`") survives on a machine with no network; the report labels which side it came from.
4. **Degrades gracefully**: `--offline` (or an unreachable network) falls back to the bundled shell-history **and known-fix** snapshots plus the local rule base; an unreadable install tree declassifies its own verdicts to *unclassified* warnings instead of inventing crashes. The env block always states which row model ran (`shell graph rows: 9 immediate + 37 lazy` / `scan-only` / `UNREADABLE`) — the model is part of the answer. A diagnostic tool must never itself crash, and it must never be more confident than its inputs.

**Privacy**: online mode makes exactly three kinds of GET requests — `dsh-insights.com` data files and npm registry `latest` metadata for your installed plugin names. Nothing about your machine is ever uploaded; nothing is written to disk.

## CLI reference

```
dsh-why [--json] [--offline] [--profile <name>] [--dsh-home <path>]
        [--lang zh|en] [--no-color] [--version] [--help]
```

| flag | meaning |
|---|---|
| `--json` | machine-readable report (findings carry structured fields; includes `issueTemplate`) |
| `--offline` | zero network — bundled shell-history snapshot + local rules |
| `--profile <name>` | which profile to diagnose (default: `web`, or the only one present) |
| `--error [text]` | parse a pasted error text instead of scanning the profile (reads stdin when the value is omitted; piped stdin is auto-detected) |
| `--prompt` | append a paste-ready fix prompt for an AI coding agent |
| `--dsh-home <path>` | override `DSH_HOME` (env `DSH_HOME` is honored too) |
| `--lang zh\|en` | output language (default: from `LC_ALL`/`LANG`) |
| `--no-color` | disable ANSI colors (`NO_COLOR` env respected) |

**Exit codes**: `0` = no crash-level findings · `1` = crash-level findings (usable as a CI gate) · `2` = usage error or an internal bug (please report).

Environment overrides for unusual setups: `DSH_WHY_NPM_ROOT` (where the global npm packages live), `DSH_WHY_PROFILE` (profile name).

## For plugin authors

- Guard optional host modules: `try { require("@deepseek-ai/dsh-client-store") } catch { /* fallback */ }` — the loader resolves `require()` at call time, so a paired catch turns a crash into a graceful degradation. dsh-why reports guarded misses as notes, never as crashes.
- Declare `engines.dsh` in package.json and keep it honest.
- Pre-publish gate in CI: `npx dsh-why --json` (exit 1 when something would crash). PRs welcome for a `--package <dir>` self-check mode.

## Related

- [dsh-insights.com](https://dsh-insights.com) — the dsh plugin ecosystem observatory (health grades, scenario picks, the observed-compat matrix this tool cross-checks against). Data source: [`/data/compat-observed.json`](https://dsh-insights.com/data/compat-observed.json).
- [dsh-insights-kit](https://github.com/ice5kysl/dsh-insights-kit) — the in-dsh panel for *proactive* health checks; dsh-why is the *reactive* CLI for when something already broke.
- [中文文档](./README.zh-CN.md)

## License

[MIT](./LICENSE) © ice5kysl
