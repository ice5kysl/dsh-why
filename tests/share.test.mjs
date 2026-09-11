import { createServer } from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSharePayloads, postShare } from '../lib/share.mjs'

const baseReport = {
  install: { dshVersion: '0.1.5', shellVersion: '0.1.5-rc.1', shellPkg: '@deepseek-ai/dsh-shell' },
  findings: [
    { rule: 'R1', severity: 'error', plugin: 'dsh-foo', version: '1.2.0', missing: ['client-modules'] },
    { rule: 'R5', severity: 'note', plugin: 'dsh-bar' },
    { rule: 'R2', severity: 'warning', plugin: 'dsh-baz' },
  ],
}

test('buildSharePayloads keeps only crash-level findings', () => {
  const payloads = buildSharePayloads(baseReport)
  assert.equal(payloads.length, 1)
  const p = payloads[0]
  assert.equal(p.v, 1)
  assert.equal(p.category, 'module-missing')
  assert.equal(p.shell, '0.1.5-rc.1')
  assert.equal(p.plugin, 'dsh-foo')
  assert.equal(p.plugin_ver, '1.2.0')
  assert.equal(p.code, 'R1')
  assert.match(p.sig, /^r1_[0-9a-f]{16}$/)
})

test('buildSharePayloads maps unknown rules to category other', () => {
  const report = {
    install: { shellVersion: '0.1.5' },
    findings: [{ rule: 'R9', severity: 'error', plugin: 'dsh-x' }],
  }
  const [p] = buildSharePayloads(report)
  assert.equal(p.category, 'other')
  assert.match(p.sig, /^r9_[0-9a-f]{16}$/)
  assert.equal('plugin_ver' in p, false)
})

test('buildSharePayloads is deterministic per finding', () => {
  const a = buildSharePayloads(baseReport)[0]
  const b = buildSharePayloads(structuredClone(baseReport))[0]
  assert.equal(a.sig, b.sig)
})

test('buildSharePayloads returns [] without errors or shell version', () => {
  assert.deepEqual(buildSharePayloads({ install: { shellVersion: '0.1.5' }, findings: [] }), [])
  assert.deepEqual(buildSharePayloads({ findings: baseReport.findings }), [])
  assert.deepEqual(buildSharePayloads(null), [])
})

test('buildSharePayloads never leaks non-whitelist fields', () => {
  const report = {
    install: { shellVersion: '0.1.5' },
    findings: [{
      rule: 'R1',
      severity: 'error',
      plugin: 'dsh-foo',
      message: 'user prompt text that must never leave',
      path: '/Users/someone/secret/file.js',
      args: { token: 'abc' },
    }],
  }
  const [p] = buildSharePayloads(report)
  assert.deepEqual(Object.keys(p).sort(), ['category', 'code', 'plugin', 'shell', 'sig', 'v'])
  assert.ok(!JSON.stringify(p).includes('secret'))
  assert.ok(!JSON.stringify(p).includes('user prompt'))
})

test('postShare posts JSON and reports the collector id', async () => {
  const received = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      received.push({ method: req.method, body: JSON.parse(body) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, id: 'r_20260911_abcd' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/report`
    const result = await postShare({ v: 1, sig: 'r1_0123456789abcdef', category: 'other', shell: '0.1.5' }, { endpoint })
    assert.deepEqual(result, { ok: true, id: 'r_20260911_abcd' })
    assert.equal(received.length, 1)
    assert.equal(received[0].method, 'POST')
    assert.equal(received[0].body.sig, 'r1_0123456789abcdef')
  } finally {
    server.close()
  }
})

test('postShare degrades instead of throwing', async () => {
  const unreachable = await postShare({ v: 1 }, { endpoint: 'http://127.0.0.1:1/v1/report', timeoutMs: 500 })
  assert.equal(unreachable.ok, false)
  assert.ok(unreachable.error)

  const server = createServer((req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'schema rejected' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const rejected = await postShare({ v: 2 }, { endpoint: `http://127.0.0.1:${server.address().port}/` })
    assert.deepEqual(rejected, { ok: false, error: 'schema rejected' })
  } finally {
    server.close()
  }
})
