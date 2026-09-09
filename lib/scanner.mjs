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
 * Guard labels per require:
 *   unguarded  — not inside any paired try/catch (a bare try or try/finally
 *                counts as unguarded: the exception escapes)
 *   in-try     — inside the try block of a pair that HAS a catch
 *   in-catch   — inside the catch block of that pair
 *
 * Per-version verdict (statusFor): any unguarded miss → broken. Otherwise
 * each pair is evaluated: try side fully resolvable → OK (catch never runs);
 * try has misses → catch fully resolvable (empty catch = graceful degrade) →
 * OK; catch also misses → broken.
 *
 * @module dsh-why/scanner
 */

const IDENT = /[A-Za-z0-9_$]/

/**
 * Brace-matching scan for try{...}catch{...} pairs; returns each pair's
 * try/catch content ranges (excluding the braces themselves). String,
 * template (incl. nested ${} expressions), line/block comment, and regex
 * literals are skipped so braces or try/catch words inside them cannot
 * disturb the pairing. A try without a paired catch (bare try, try/finally)
 * produces no pair — its content is treated as unguarded. Pairs left open at
 * EOF are dropped (conservative: unguarded).
 */
function scanTryCatchPairs(text) {
  const pairs = []
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
  return pairs.filter((p) => p.catchEnd != null)
}

/**
 * Guard-aware require extraction. `requires` is the flat deduped literal set
 * (template-string/dynamic requires excluded — statically undecidable, never
 * reported as missing); `requiresV2` additionally labels each occurrence's
 * guard context:
 *   { spec, guard: 'unguarded' }
 *   { spec, guard: 'in-try',   pair: <id> }
 *   { spec, guard: 'in-catch', pair: <id> }
 * The same spec appearing under different guards is kept once per context
 * (pair ids group by try-close order and are self-consistent within one scan).
 */
export function extractRequiresV2(bundleText) {
  const pairs = scanTryCatchPairs(bundleText)
  const regions = []
  for (const [id, p] of pairs.entries()) {
    regions.push({ start: p.tryStart, end: p.tryEnd, kind: 'in-try', pair: id })
    regions.push({ start: p.catchStart, end: p.catchEnd, kind: 'in-catch', pair: id })
  }
  const seenFlat = new Set()
  const seenV2 = new Set()
  const requires = []
  const requiresV2 = []
  const pattern = /\b__require\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g
  let match
  while ((match = pattern.exec(bundleText)) !== null) {
    const spec = match[1] ?? match[2]
    if (spec.includes('${')) continue
    if (!seenFlat.has(spec)) { seenFlat.add(spec); requires.push(spec) }
    let best = null // innermost region containing this position (max start wins)
    for (const rg of regions) {
      if (match.index >= rg.start && match.index < rg.end && (!best || rg.start > best.start)) best = rg
    }
    const key = best ? `${spec} ${best.kind} ${best.pair}` : `${spec} `
    if (seenV2.has(key)) continue
    seenV2.add(key)
    requiresV2.push(best ? { spec, guard: best.kind, pair: best.pair } : { spec, guard: 'unguarded' })
  }
  return { requires, requiresV2 }
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

/** Resolvability of one require under a shell version: seed table ∪ own package name ∪ known plugin packages (registered client factories). */
export function resolvable(spec, seed, pkgName, knownPkgs) {
  return seed.has(spec) || stripClientSuffix(spec) === pkgName || knownPkgs.has(stripClientSuffix(spec))
}

/**
 * Guard-aware single-version verdict:
 *   unguarded misses → broken (crashes on the loader's boot path);
 *   otherwise evaluate each try/catch pair — try fully resolvable → OK (the
 *   catch never runs); try misses but catch fully resolvable (empty catch
 *   counts — graceful degradation) → OK; catch also misses → broken.
 * Returns { status: 'ok' } | { status: 'broken', missing } — missing lists
 * unguarded misses plus both sides of collapsed pairs (ok versions record no
 * missing: a guarded require is not a defect).
 */
export function statusFor(requiresV2, seed, pkgName, knownPkgs) {
  const hardMissing = []
  const pairMiss = new Map() // pair -> { try: [], catch: [] }
  for (const r of requiresV2) {
    if (resolvable(r.spec, seed, pkgName, knownPkgs)) continue
    if (r.guard === 'unguarded') hardMissing.push(r.spec)
    else {
      const e = pairMiss.get(r.pair) || { try: [], catch: [] }
      e[r.guard === 'in-try' ? 'try' : 'catch'].push(r.spec)
      pairMiss.set(r.pair, e)
    }
  }
  if (hardMissing.length) return { status: 'broken', missing: hardMissing }
  const missing = []
  for (const e of pairMiss.values()) {
    if (!e.try.length) continue
    if (!e.catch.length) continue
    missing.push(...e.try, ...e.catch)
  }
  return missing.length ? { status: 'broken', missing } : { status: 'ok' }
}
