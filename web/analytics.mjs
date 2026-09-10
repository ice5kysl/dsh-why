/**
 * dsh-why web — privacy-respecting Google Analytics 4 pageviews.
 *
 * Two deliberate guardrails, so the product's "nothing you paste leaves the
 * browser" promise survives analytics:
 *   1. the paste box is NOT instrumented — no diagnostic content, ever;
 *   2. the URL query is stripped before reporting — a shared `?e=<pasted error>`
 *      permalink must never reach Google, so GA only sees origin + path.
 *
 * No-op until GA_ID is set (an empty ID never loads gtag.js).
 *
 * @module dsh-why/web/analytics
 */

const GA_ID = 'G-0L72MNJF9P' // GA4 Measurement ID

if (GA_ID && typeof window !== 'undefined') {
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID
  document.head.appendChild(s)
  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag
  gtag('js', new Date())
  // strip the query string: a pasted error in ?e= (and ?v=/?lang=) stays local
  gtag('config', GA_ID, { page_location: location.origin + location.pathname })
}
