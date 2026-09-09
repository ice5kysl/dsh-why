/**
 * semver.satisfies — pragmatic range checks for engines.dsh (dsh ships
 * almost only prereleases, so ranges like "^0.1.1" must cover 0.1.2-rc.1).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { satisfies } from '../lib/semver.mjs'

describe('satisfies', () => {
  it('caret ranges cover later prereleases in range (the dsh reality)', () => {
    assert.equal(satisfies('0.1.2-rc.1', '^0.1.1'), true)
    assert.equal(satisfies('0.1.5-alpha.1', '^0.1.1'), true)
    assert.equal(satisfies('0.2.0', '^0.1.1'), false)
    assert.equal(satisfies('0.1.0-rc.8', '^0.1.1'), false)
  })

  it('caret on 0.x pins the minor', () => {
    assert.equal(satisfies('1.4.2', '^1.2.3'), true)
    assert.equal(satisfies('2.0.0', '^1.2.3'), false)
  })

  it('comparators and exact versions', () => {
    assert.equal(satisfies('0.1.2-rc.1', '>=0.9.0'), false)
    assert.equal(satisfies('0.9.0-alpha.1', '>=0.9.0'), false) // prerelease < its release
    assert.equal(satisfies('0.9.0', '>=0.9.0'), true)
    assert.equal(satisfies('0.1.2-rc.1', '0.1.2-rc.1'), true)
    assert.equal(satisfies('0.1.2-rc.1', '0.1.2'), false)
    assert.equal(satisfies('0.1.0', '<0.2.0'), true)
  })

  it('tilde, star, OR branches, AND sets', () => {
    assert.equal(satisfies('0.1.7', '~0.1.2'), true)
    assert.equal(satisfies('0.2.0', '~0.1.2'), false)
    assert.equal(satisfies('9.9.9', '*'), true)
    assert.equal(satisfies('0.1.2-rc.1', '^0.1.0 || ^0.2.0'), true)
    assert.equal(satisfies('0.3.0', '^0.1.0 || ^0.2.0'), false)
    assert.equal(satisfies('0.1.5', '>=0.1.0 <0.2.0'), true)
  })

  it('unparseable ranges answer null (undecidable), never a guess', () => {
    assert.equal(satisfies('0.1.2', 'dsh@latest'), null)
    assert.equal(satisfies('not-a-version', '^0.1.0'), null)
    assert.equal(satisfies('0.1.2', ''), null)
  })
})
