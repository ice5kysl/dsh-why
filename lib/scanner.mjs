/**
 * dsh-why — guard-aware client-bundle require scanner.
 *
 * Ported (not imported — this package is zero-dependency) from
 * dsh-insights/pipeline/analyze/compat-observed.mjs, which powers the
 * observed-compatibility matrix on dsh-insights.com. Keep behavior identical
 * to the upstream extractor so local diagnoses agree with the published
 * ecosystem matrix.
 *
 * Why guard-aware: the official dsh loader (@deepseek-ai/dsh-client-modules)
 * resolves require() at CALL time inside the module factory, so a missing
 * specifier inside a `try { ... } catch { ... }` pair is caught by the catch
 * branch and does not crash the loader ("missed the module table" becomes a
 * handled fallback). A miss OUTSIDE any paired try/catch crashes the boot.
 *
 * Resolution model (2026-09-10, aligned with the loader's real branch order
 * seed → materialized → registered factory → throw): row bundles mounted in
 * the composition (packages with a dsh.client face) register factories under
 * their PACKAGE NAME when their combo batch executes, so a require() naming
 * such a row resolves without being a seed word. Three classes per specifier:
 *   ok          seed word / own package / installed plugin package /
 *               immediate row (prefetched before any plugin materializes) /
 *               lazy row the plugin declares in dsh.client.external/inject
 *               (arrival then guaranteed before its own materialization)
 *   conditional undeclared lazy row — batch timing usually resolves it but
 *               nothing guarantees the order (verified live on 0.1.2-rc.1:
 *               vision-router requiring ui-attachment loads fine)
 *   missing     everything else (e.g. @deepseek-ai/dsh-client-runtime/* —
 *               never shipped in any published shell's module table)
 *
 * Extraction scope: only CODE-STATE require literals are collected — the
 * state machine skips strings/templates/comments/regex literals, so a
 * "require(...)" mentioned inside them is never reported. Relative/absolute
 * specifiers are excluded (counted as `local`): bundle-local module tables
 * (the localRequire pattern) serve them and they never reach the loader.
 *
 * Guard labels per require:
 *   unguarded  — not inside any paired try/catch (a bare try or try/finally
 *                counts as unguarded: the exception escapes)
 *   in-try     — inside the try block of a pair that HAS a catch
 *   in-catch   — inside the catch block of that pair
 *
 * @module dsh-why/scanner
 */

const IDENT = /[A-Za-z0-9_$]/

/**
 * Single-pass state machine producing both
 *   pairs — try{...}catch{...} content ranges (excluding the braces)
 *   hits  — code-state require literals [{ index, spec }]
 * Strings, templates (incl. nested ${} expressions), line/block comments and
 * regex literals are skipped throughout: nothing inside them disturbs the
 * pairing or produces a require hit. A try without a paired catch (bare try,
 * try/finally) produces no pair — its content is treated as unguarded. Pairs
 * left open at EOF are dropped (conservative: unguarded).
 */
function scanBundle(text) {
  const pairs = []
  const hits = []
  const stack = [] // { kind: 'block'|'try'|'catch'|'tpl-expr', contentStart, pairId? }
  const n = text.length
  let i = 0
  let state = 'code' // code | str | tpl | line | block | regex | regex-class
  let quote = ''
  let prevSig = '' // previous significant char (regex vs divide heuristic)
  let prevWord = '' // previous identifier word (return /re/ etc.)

  const skipWsComments = (j) => {
    while (j < n) {
      const c = text[j]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { j++; continue }
      if (c === '/' && text[j + 1] === '/') { const e = text.indexOf('\n', j); j = e < 0 ? n : e + 1; continue }
      if (c === '/' && text[j + 1] === '*') { const e = text.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue }
      break
    }
    return j
  }

  while (i < n) {
    const c = text[i]
    if (state === 'code') {
      if (c === '_' || c === '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
        let j = i + 1
        while (j < n && IDENT.test(text[j])) j++
        const w = text.slice(i, j)
        if (w === 'try') {
          const k = skipWsComments(j)
          if (text[k] === '{') {
            stack.push({ kind: 'try', contentStart: k + 1 })
            prevSig = '{'; prevWord = ''
            i = k + 1
            continue
          }
        }
        if ((w === 'require' || w === '__require') && text[j] === '(') {
          // Same shape as the legacy regex \brequire\(\s*["']([^"']+)["']\s*\):
          // '(' right after the word, whitespace allowed before the quote.
          let k = j + 1
          while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r' || text[k] === '\f' || text[k] === '\v')) k++
          const q = text[k]
          if (q === '"' || q === "'") {
            const s = k + 1
            let e = s
            while (e < n && text[e] !== '"' && text[e] !== "'") e++
            if (e > s && text[e] === q) {
              let z = e + 1
              while (z < n && (text[z] === ' ' || text[z] === '\t' || text[z] === '\n' || text[z] === '\r' || text[z] === '\f' || text[z] === '\v')) z++
              if (text[z] === ')') hits.push({ index: i, spec: text.slice(s, e) })
            }
          }
        }
        prevWord = w
        prevSig = w[w.length - 1]
        i = j
        continue
      }
      if (c === "'" || c === '"') { state = 'str'; quote = c; i++; continue }
      if (c === '`') { state = 'tpl'; i++; continue }
      if (c === '/') {
        const nx = text[i + 1]
        if (nx === '/') { state = 'line'; i += 2; continue }
        if (nx === '*') { state = 'block'; i += 2; continue }
        const regexAllowed = !prevSig || '([{,;:!&|?+-*%^~<>='.includes(prevSig) ||
          ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do', 'yield', 'await', 'instanceof'].includes(prevWord)
        if (regexAllowed) { state = 'regex'; i++; continue }
        prevSig = '/'; prevWord = ''; i++; continue
      }
      if (c === '{') { stack.push({ kind: 'block' }); prevSig = '{'; prevWord = ''; i++; continue }
      if (c === '}') {
        const top = stack.pop()
        if (top?.kind === 'tpl-expr') { state = 'tpl'; i++; continue } // ${} closed, back to template
        if (top?.kind === 'try') {
          let j = skipWsComments(i + 1)
          if (text.startsWith('catch', j) && !IDENT.test(text[j + 5] || '')) {
            j = skipWsComments(j + 5)
            if (text[j] === '(') { // catch param (may contain destructuring braces/default strings): balance to the matching )
              let depth = 0
              while (j < n) {
                const ch = text[j]
                if (ch === "'" || ch === '"') { const q = ch; j++; while (j < n && text[j] !== q) j += text[j] === '\\' ? 2 : 1; j++; continue }
                if (ch === '(') depth++
                else if (ch === ')') { depth--; if (!depth) { j++; break } }
                j++
              }
              j = skipWsComments(j)
            }
            if (text[j] === '{') {
              const pairId = pairs.length
              pairs.push({ tryStart: top.contentStart, tryEnd: i, catchStart: j + 1, catchEnd: null })
              stack.push({ kind: 'catch', pairId })
              prevSig = '{'; prevWord = ''
              i = j + 1
              continue
            }
          }
          prevSig = '}'; prevWord = ''; i++; continue // no catch: finally/bare try — not a pair
        }
        if (top?.kind === 'catch') {
          pairs[top.pairId].catchEnd = i
          prevSig = '}'; prevWord = ''; i++; continue
        }
        prevSig = '}'; prevWord = ''; i++; continue
      }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
      prevSig = c
      prevWord = ''
      i++
      continue
    }
    if (state === 'str') {
      if (c === '\\') { i += 2; continue }
      if (c === quote) { state = 'code'; prevSig = quote; prevWord = '' }
      i++
      continue
    }
    if (state === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { state = 'code'; prevSig = '`'; prevWord = ''; i++; continue }
      if (c === '$' && text[i + 1] === '{') { stack.push({ kind: 'tpl-expr' }); state = 'code'; i += 2; continue }
      i++
      continue
    }
    if (state === 'line') {
      if (c === '\n') state = 'code'
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && text[i + 1] === '/') { state = 'code'; i += 2; continue }
      i++
      continue
    }
    if (state === 'regex') {
      if (c === '\\') { i += 2; continue }
      if (c === '[') { state = 'regex-class'; i++; continue }
      if (c === '/') { state = 'code'; prevSig = '/'; prevWord = ''; i++; continue }
      if (c === '\n') { state = 'code'; i++; continue } // unterminated regex: defensively back to code
      i++
      continue
    }
    if (state === 'regex-class') {
      if (c === '\\') { i += 2; continue }
      if (c === ']') state = 'regex'
      i++
      continue
    }
  }
  return { pairs: pairs.filter((p) => p.catchEnd != null), hits }
}

/**
 * Guard-aware require extraction from scanBundle hits.
 *   requires   — flat deduped external specifier set (template-string/dynamic
 *                requires excluded — statically undecidable; relative and
 *                absolute specifiers excluded — bundle-local module tables
 *                serve them and the loader can never resolve them)
 *   requiresV2 — each require labeled with its guard context:
 *   { spec, guard: 'unguarded' } / { spec, guard: 'in-try', pair: id } /
 *   { spec, guard: 'in-catch', pair: id }
 *   local      — count of skipped relative/absolute specifiers (diagnostics)
 * The same spec appearing under different guards is kept once per context
 * (pair ids group by try-close order and are self-consistent within one scan).
 */
export function extractRequiresV2(bundleText) {
  const { pairs, hits } = scanBundle(bundleText)
  const regions = []
  for (const [id, p] of pairs.entries()) {
    regions.push({ start: p.tryStart, end: p.tryEnd, kind: 'in-try', pair: id })
    regions.push({ start: p.catchStart, end: p.catchEnd, kind: 'in-catch', pair: id })
  }
  const seenFlat = new Set()
  const seenV2 = new Set()
  const requires = []
  const requiresV2 = []
  let local = 0
  for (const hit of hits) {
    const spec = hit.spec
    if (spec.includes('${')) continue
    if (spec[0] === '.' || spec[0] === '/') { local++; continue }
    if (!seenFlat.has(spec)) { seenFlat.add(spec); requires.push(spec) }
    let best = null // innermost region containing this position (max start wins)
    for (const rg of regions) {
      if (hit.index >= rg.start && hit.index < rg.end && (!best || rg.start > best.start)) best = rg
    }
    const key = best ? `${spec} ${best.kind} ${best.pair}` : `${spec} `
    if (seenV2.has(key)) continue
    seenV2.add(key)
    requiresV2.push(best ? { spec, guard: best.kind, pair: best.pair } : { spec, guard: 'unguarded' })
  }
  return { requires, requiresV2, local }
}

/** Mirrors @deepseek-ai/dsh-client-modules: a "pkg/client" require resolves to "pkg". */
export function stripClientSuffix(spec) {
  return spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
}

/** Minimal semver compare: numeric segments first, then prerelease tag by dictionary order (alpha < beta < rc) and number; release > prerelease. */
export function compareVersions(a, b) {
  const [ma, pa] = a.split('-'), [mb, pb] = b.split('-')
  const na = ma.split('.').map(Number), nb = mb.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] - nb[i]
  if (!pa && !pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  const [ta, na2] = pa.split('.'), [tb, nb2] = pb.split('.')
  if (ta !== tb) return ta < tb ? -1 : 1
  return (Number(na2) || 0) - (Number(nb2) || 0)
}

const RANK = { ok: 0, conditional: 1, unknown: 1, missing: 2 }
const EMPTY_SET = new Set()

/**
 * Normalize the shell's client graph rows into lookup sets plus a `known` flag.
 * Accepts arrays or Sets:
 *   { immediate, lazy }         — the mounted row set (roster-verified)
 *   { immediate, lazy, exact }  — `exact: false` = scan-only approximation
 *   null / undefined            — the install tree was unreadable, so the
 *                                 loader's THIRD branch (registered factories)
 *                                 is unobservable. classify() then answers
 *                                 'unknown' instead of guessing 'missing' —
 *                                 guessing 'missing' is what produced false
 *                                 crash reports (the vision-router case).
 * @returns {{ immediate: Set<string>, lazy: Set<string>, known: boolean, exact: boolean }}
 */
export function rowIndex(rows) {
  const toSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []))
  if (!rows) return { immediate: new Set(), lazy: new Set(), known: false, exact: false }
  return { immediate: toSet(rows.immediate), lazy: toSet(rows.lazy), known: true, exact: rows.exact !== false }
}

/** Accept either raw rows or an already-normalized index (hot path: normalize once per plugin). */
function asIndex(rows) {
  return rows && typeof rows.known === 'boolean' ? rows : rowIndex(rows)
}

/**
 * Classify one require against a shell: the loader's real resolution order is
 * seed → materialized → registered factory, and row bundles register factories
 * under their package name when their combo batch executes.
 *   rows     the shell's client graph rows (raw or {@link rowIndex}-normalized)
 *   declared the plugin's own dsh.client external+inject (normalized): a
 *            declared lazy row is guaranteed to arrive before the plugin
 *            materializes, which upgrades it to ok.
 * Returns 'ok' | 'conditional' | 'missing' | 'unknown'. 'unknown' means the
 * row branch could not be observed at all: neither a crash nor a clean bill of
 * health, so callers must never turn it into an error.
 */
export function classify(spec, seed, pkgName, knownPkgs, rows = null, declared = EMPTY_SET) {
  if (seed.has(spec)) return 'ok'
  const id = stripClientSuffix(spec)
  if (id === pkgName || knownPkgs.has(id)) return 'ok'
  const idx = asIndex(rows)
  if (!idx.known) return 'unknown'
  if (idx.immediate.has(id)) return 'ok'
  if (idx.lazy.has(id)) return declared.has(id) ? 'ok' : 'conditional'
  return 'missing'
}

/** Boolean convenience wrapper: true when classify() says the specifier resolves for certain. */
export function resolvable(spec, seed, pkgName, knownPkgs, rows = null, declared = EMPTY_SET) {
  return classify(spec, seed, pkgName, knownPkgs, rows, declared) === 'ok'
}

/**
 * Guard-aware single-version verdict, three states:
 *   unguarded missing → broken; unguarded conditional/unknown → conditional;
 *   per try/catch pair — try fully ok → ok; try has missing → catch fully ok
 *   (empty catch included) → ok, catch uncertain → conditional, catch missing
 *   → broken; try uncertain → catch fully ok → ok, else conditional.
 * Returns { status: 'ok' }
 *       | { status: 'conditional', conditional: string[], unknown: string[] }
 *       | { status: 'broken', missing: string[], conditional?: string[], unknown?: string[] }
 * The two uncertain buckets are disjoint: 'conditional' holds known lazy rows
 * (resolves by batch timing), 'unknown' holds specifiers the row model could
 * not judge at all. A broken result still carries them when both classes are
 * present, so the report never silently drops what it could not decide.
 */
export function statusFor(requiresV2, seed, pkgName, knownPkgs, rows = null, declared = EMPTY_SET) {
  const idx = asIndex(rows)
  const hardMissing = []
  const uncertain = [] // { spec, label }
  const pairRank = new Map() // pair -> { try, catch, tryItems, catchItems }
  for (const r of requiresV2) {
    const label = classify(r.spec, seed, pkgName, knownPkgs, idx, declared)
    if (label === 'ok') continue
    if (r.guard === 'unguarded') {
      if (label === 'missing') hardMissing.push(r.spec)
      else uncertain.push({ spec: r.spec, label })
    } else {
      const e = pairRank.get(r.pair) || { try: 0, catch: 0, tryItems: [], catchItems: [] }
      const side = r.guard === 'in-try' ? 'try' : 'catch'
      if (RANK[label] > e[side]) e[side] = RANK[label]
      e[`${side}Items`].push({ spec: r.spec, label })
      pairRank.set(r.pair, e)
    }
  }
  if (hardMissing.length) return { status: 'broken', missing: dedupe(hardMissing), ...uncertainLists(uncertain) }
  const missing = []
  const items = [...uncertain]
  for (const e of pairRank.values()) {
    if (e.try === 0) continue
    if (e.try === 2) {
      if (e.catch === 0) continue
      if (e.catch === 1) items.push(...e.tryItems, ...e.catchItems)
      else missing.push(...e.tryItems.map((i) => i.spec), ...e.catchItems.map((i) => i.spec))
    } else { // try === 1: likely resolves; if it throws, a non-ok catch leaves the pair uncertain
      if (e.catch > 0) items.push(...e.tryItems, ...e.catchItems)
    }
  }
  if (missing.length) return { status: 'broken', missing: dedupe(missing), ...uncertainLists(items) }
  const lists = uncertainLists(items)
  if (lists.conditional.length || lists.unknown.length) return { status: 'conditional', ...lists }
  return { status: 'ok' }
}

function dedupe(specs) {
  return [...new Set(specs)]
}

/** Split uncertain specs into the two labels, order-preserving and deduped. */
function uncertainLists(items) {
  const conditional = []
  const unknown = []
  for (const { spec, label } of items) {
    const bucket = label === 'unknown' ? unknown : conditional
    if (!bucket.includes(spec)) bucket.push(spec)
  }
  return { conditional, unknown }
}
