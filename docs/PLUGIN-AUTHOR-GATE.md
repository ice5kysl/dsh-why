# The pre-publish gate for dsh plugin authors

dsh does not let a plugin's client bundle `require()` arbitrary npm packages. It
resolves `require()` against a **module table baked into each shell build**. When
a module moves — added in a later shell, retired in a newer one — an **unguarded**
`require()` throws, and because the loader materializes the whole client plugin
tree, **one plugin takes every plugin down**:

```
HARNESS Failed to load plugins: failed to import loader entry (dsh-at-file):
client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table
```

dsh ships several times a day. Nothing in your repo tells you when an upstream
change would do that to yours — until your users do.

## The 30-second version

```
npx dsh-why --package .
```

It reads your `package.json`, your declared client entry, every `require()` in the
built bundle, and your `engines.dsh` range, then classifies each one against the
real module table of the shell you run. **Read-only. Zero dependencies. Nothing
leaves your machine** — there is no upload and no account.

## Put it in CI

The gate is only worth having if it runs without anyone remembering to run it.
Any non-zero exit must block the release.

**GitHub Actions** — add `.github/workflows/dsh-why.yml`:

```yaml
name: dsh-why gate
on: [push, pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build          # the gate checks the BUILT bundle
      - run: npx dsh-why --package .
```

**As a publish guard** — in `package.json`:

```json
{ "scripts": { "prepublishOnly": "npm run build && dsh-why --package ." } }
```

## Exit codes, and what each one asks you to do

| code | meaning | what to do |
|---|---|---|
| `0` | no crash-level findings | publish |
| `1` | a crash-level finding: an unguarded `require()` the shell cannot resolve | fix it — the report names the module, its per-shell history, and the known fix |
| `3` | **the check could not be performed** | build first, or point `--package` at the real directory |
| `2` | usage error | check the arguments |

`3` exists because a gate that passes when it verified nothing is worse than no
gate. `--package` returns it when the path has no `package.json`, or when
`dsh.client` is declared but no bundle could be read — almost always an unbuilt
checkout, since the client bundle is a build artifact and is not committed.

## The three verdicts, and why "conditional" is not a failure

dsh-why will never turn a blind eye into a red card:

- **crash (exit 1)** — the module is not in the shell's table and is not a graph
  row. This is the real thing.
- **conditional (exit 0)** — the specifier is a built-in graph row: not a seed
  word, but its bundle registers a factory when its combo batch runs. It usually
  resolves, and the *ordering is not guaranteed*. Declare it in
  `dsh.client.external` (or `inject`) and the loader arrives it before your plugin
  materializes — conditional becomes certain.
- **could not verify (exit 3)** — see above. Reported as unknown, never as a pass.

## The fix pattern

The loader resolves `require()` **at call time**, so a paired `catch` turns a crash
into a graceful degradation:

```js
let store = null
try { store = require('@deepseek-ai/dsh-client-store') } catch { /* feature off */ }
```

If the feature is essential, bundle the dependency into your plugin instead
(keeping `react` and `@deepseek-ai/cordis` external to avoid duplicate copies).

## Why this is worth 30 seconds of your CI

Measured on 2026-09-11 by running the gate against **13 popular published
plugins** (including `dsh-better-sidebar`, `dsh-cost-meter`, `dsh-pocket`,
`dsh-chat-import`, `dsh-permission-rules`, `dsh-vision-router`, `dsh-free-search`):

- **zero false positives** — nine came back clean, and one came back *conditional*
  correctly, with the ecosystem case base noting that an earlier tool had
  misjudged that exact plugin as a crash and later retracted it;
- the remaining four came back `3`, all of them for the honest reason: a fresh
  clone whose bundle is not built yet (that is the `npm run build` step above);
- **no plugin was found broken.** Published plugins work.

That last point is the point. **This gate is quiet on healthy plugins. It is not a
cleanup tool — it is a regression guard**, and the thing it guards against is
upstream: dsh ships several times a day, and a module moving between shell builds
is what takes a working plugin down.

## Badge

If the gate runs in your CI, this is an honest claim to make:

```markdown
[![dsh-why: pre-publish gate](https://img.shields.io/badge/dsh--why-pre--publish%20gate-blue)](https://dsh-why.com/e/missed-the-module-table/)
```

Please only add it once the workflow above is actually running — the badge is a
statement about your repo, not about this tool.

---

Docs and the full error reference: **https://dsh-why.com**
Source: https://github.com/ice5kysl/dsh-why · npm: https://www.npmjs.com/package/dsh-why
