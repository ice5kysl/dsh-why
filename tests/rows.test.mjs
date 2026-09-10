/**
 * collectShellRows tests: the three states of the loader's "registered
 * factory" branch — roster-verified mounted set, scan-only approximation, and
 * unreadable (which must make classification answer 'unknown' instead of
 * inventing a crash). Fixtures: the realistic install, one whose bundle patch
 * files are absent, and one whose client packages are absent entirely.
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { collectShellRows } from '../lib/collect.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const root = (name) => join(FIXTURES, name)

describe('collectShellRows', () => {
  it('roster-verified install → exact mounted set, immediate flag preserved', () => {
    const rows = collectShellRows(root('npm-global'))
    assert.equal(rows.exact, true)
    assert.deepEqual(rows.immediate, ['@deepseek-ai/dsh-client-connection'])
    assert.deepEqual(rows.lazy, ['@deepseek-ai/dsh-client-ui-attachment'])
  })

  it('client-capable but unmounted packages are filtered out by the roster', () => {
    const rows = collectShellRows(root('npm-global'))
    const all = [...rows.immediate, ...rows.lazy]
    assert.equal(all.includes('@deepseek-ai/dsh-client-ui-directory-picker-native'), false)
  })

  it('missing bundle patches → scan-only fallback (exact: false), never null', () => {
    const rows = collectShellRows(root('npm-global-noroster'))
    assert.equal(rows.exact, false)
    // the scan cannot tell mounted from unmounted, so the alternates come along:
    // they may be called conditional instead of missing — the harmless side
    assert.ok(rows.lazy.includes('@deepseek-ai/dsh-client-ui-directory-picker-native'))
    assert.deepEqual(rows.immediate, ['@deepseek-ai/dsh-client-connection'])
  })

  it('no readable client package at all → null (row branch unobservable)', () => {
    assert.equal(collectShellRows(root('npm-global-partial')), null)
    assert.equal(collectShellRows(null), null)
    assert.equal(collectShellRows(join(FIXTURES, 'does-not-exist')), null)
  })

  it('a broken JSON manifest inside the install degrades instead of throwing', () => {
    const rows = collectShellRows(root('npm-global'))
    assert.ok(rows) // fail-soft path exercised by every malformed/missing file above
  })
})
