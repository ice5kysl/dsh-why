/**
 * dsh-why web — cookie-less pageview counting (Umami), same website id as dsh-insights.com.
 *
 * Three deliberate guardrails, so the product's "nothing you paste leaves the
 * browser" promise survives analytics:
 *   1. the paste box is NOT instrumented — no diagnostic content, ever;
 *   2. the URL query is stripped before reporting (`data-exclude-search`) — a
 *      shared `?e=<pasted error>` permalink must never reach the collector;
 *   3. the hash is stripped as well (`data-exclude-hash`) — only origin + path
 *      is ever reported, exactly as the previous setup did.
 *
 * Guardrail 2 also strips utm_* from the reported URL, and Umami reads
 * attribution server-side from exactly that field — so the before-send hook
 * re-attaches ONLY the attribution whitelist (utm_source/medium/campaign/
 * content/term) from the live location. Pasted errors (`e=`) and anything
 * else in the query still never leave the browser.
 *
 * No cookies and no cross-site identifiers: Umami stores aggregate counts only
 * (pageviews / referrer / country / device), never personal data. dsh-why.com
 * and dsh-insights.com report under ONE website id and are told apart by the
 * hostname dimension in the dashboard. No-op until WEBSITE_ID is set.
 *
 * @module dsh-why/web/analytics
 */

const WEBSITE_ID = '7fc5eb24-1687-4827-9775-5326d957b46a'
// client-side whitelist: production domains only, so local/preview noise stays out
const DOMAINS = 'dsh-why.com,www.dsh-why.com,dsh-insights.com,www.dsh-insights.com'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

// Referenced by name in data-before-send; must be a global on window.
function dshWhyBeforeSend(type, payload) {
  if (payload?.url && window.location.search.length > 1) {
    const inbound = new URLSearchParams(window.location.search)
    const keep = new URLSearchParams()
    for (const key of UTM_KEYS) {
      const value = inbound.get(key)
      if (value) keep.set(key, value)
    }
    const qs = keep.toString()
    if (qs) payload.url += (payload.url.includes('?') ? '&' : '?') + qs
  }
  return payload
}

if (WEBSITE_ID && typeof window !== 'undefined') {
  window.dshWhyBeforeSend = dshWhyBeforeSend
  const s = document.createElement('script')
  s.defer = true
  s.src = 'https://cloud.umami.is/script.js'
  s.dataset.websiteId = WEBSITE_ID
  s.dataset.domains = DOMAINS
  s.dataset.excludeSearch = 'true'
  s.dataset.excludeHash = 'true'
  s.dataset.beforeSend = 'dshWhyBeforeSend'
  document.head.appendChild(s)
}
