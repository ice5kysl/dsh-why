/**
 * dsh-why — pasted-error parser. Users arrive holding a red-screen console
 * dump; this module recognizes the known dsh loader error shapes and pulls
 * out the references (plugin names, module specifiers) worth diagnosing.
 *
 * Recognized patterns (extend this list as the ecosystem reports new ones):
 *   failed to import loader entry <hash> (<pkg>)            → plugin
 *   require("<mod>") missed the module table                → module
 *   bundle script /plugins/<pkg>/client.js failed to load   → plugin
 *   cannot resolve "<mod>"                                  → module (async twin)
 *   Failed to load plugins                                  → bare (no specific ref)
 *
 * @module dsh-why/errparse
 */

const PATTERNS = [
  { id: 'loader-entry', kind: 'plugin', re: /failed to import loader entry\s+\S+\s+\(([^)]+)\)/gi },
  { id: 'missed-module-table', kind: 'module', re: /require\(["']([^"']+)["']\)\s+missed the module table/gi },
  { id: 'bundle-script', kind: 'plugin', re: /bundle script\s+\/plugins\/((?:[^/\s]+\/)?[^/\s]+)\/client\.js\s+failed to load/gi },
  { id: 'cannot-resolve', kind: 'module', re: /cannot resolve\s+["']([^"']+)["']/gi },
]

const BARE_RE = /failed to load plugins/i

/** Decode a URL-escaped path segment back to a package name; never throws. */
function decodeName(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Parse a pasted error text. Returns:
 *   { recognized, bare, plugins, modules, matched }
 * - recognized: at least one plugin/module reference extracted
 * - bare: only the generic "Failed to load plugins" line matched (caller
 *   falls back to a full environment diagnosis)
 * - matched: pattern ids that fired (for the "known patterns" list)
 */
export function parseErrorText(text) {
  const plugins = []
  const modules = []
  const matched = []
  if (typeof text === 'string' && text) {
    for (const { id, kind, re } of PATTERNS) {
      re.lastIndex = 0
      let m
      let hit = false
      while ((m = re.exec(text)) !== null) {
        hit = true
        const value = decodeName(m[1].trim())
        if (!value) continue
        const list = kind === 'plugin' ? plugins : modules
        if (!list.includes(value)) list.push(value)
      }
      if (hit) matched.push(id)
    }
  }
  const bare = !plugins.length && !modules.length && BARE_RE.test(text ?? '')
  return { recognized: plugins.length + modules.length > 0, bare, plugins, modules, matched }
}

/** The pattern list, for the "we don't know this one yet" honest answer. */
export function knownPatterns() {
  return [
    'failed to import loader entry <hash> (<plugin>)',
    'require("<module>") missed the module table',
    'bundle script /plugins/<plugin>/client.js failed to load',
    'cannot resolve "<module>"',
    'Failed to load plugins',
  ]
}
