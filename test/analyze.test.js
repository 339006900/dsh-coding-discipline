/**
 * Tests for the analysis layer, the page renderer, and the route handler.
 *
 * The analysis produces the numbers, so it is fed synthetic event streams with
 * known answers rather than whatever a real log happens to contain today.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { zstdCompressSync } from 'node:zlib'

import { analyzeSession, findClaims, summarize } from '../src/analyze.js'
import { registerDashboard } from '../src/index.js'
import { renderDashboard } from '../src/report.js'
import { createDashboardHandler, createDashboardPage, ROUTE_PATH } from '../src/route.js'
import { decodeZstdFrames, listSessionFiles, readSessionEvents, SESSION_FILE } from '../src/sessions.js'

const T0 = Date.parse('2026-11-01T10:00:00Z')

/** @param {string} text */
function assistantTurn(turn, text) {
  return { type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } }
}

/** @param {number} turn */
function editCall(turn) {
  return { type: 'tool/call', data: { turn, step: 1, name: 'edit', arguments: '{"file_path":"a.cpp"}' } }
}

/** @param {number} turn */
function bashCall(turn, command) {
  return { type: 'tool/call', data: { turn, step: 1, name: 'ops_bash', arguments: JSON.stringify({ command }) } }
}

/** @param {string} systemText */
function sessionEvents(systemText, turnEvents) {
  return [
    { type: 'session', id: 's1', createdAt: T0, data: { id: 's1', createdAt: T0, cwd: 'C:/proj' } },
    { type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: systemText }] } } },
    ...turnEvents,
    { type: 'turn/end', data: { turn: 1 }, time: T0 + 1000 },
  ]
}

test('an edited turn with a verification command closes the loop', () => {
  const events = sessionEvents('<coding_discipline> rules', [
    { type: 'turn/start', data: { turn: 1 }, time: T0 },
    editCall(1),
    bashCall(1, 'npm test'),
    assistantTurn(1, '改好了，npm test 通过'),
  ])
  const session = analyzeSession(events)
  assert.equal(session.arm, 'with')
  assert.equal(session.cwd, 'C:/proj')
  assert.equal(session.totals.editTurns, 1)
  assert.equal(session.totals.editVerifiedTurns, 1)
  assert.equal(session.totals.closureRate, 1)
  assert.equal(session.totals.claims, 1)
  assert.equal(session.totals.claimsWithEvidence, 1)
})

test('an edited turn without a verification command is an open loop', () => {
  const events = sessionEvents('plain prompt', [
    { type: 'turn/start', data: { turn: 1 }, time: T0 },
    editCall(1),
    assistantTurn(1, '已完成'),
  ])
  const session = analyzeSession(events)
  assert.equal(session.arm, 'without')
  assert.equal(session.totals.closureRate, 0)
  assert.equal(session.totals.claimsWithoutEvidence, 1)
  assert.equal(session.turns[0].claimWithoutEvidence, true)
})

test('a read-only bash call is not verification', () => {
  const events = sessionEvents('plain prompt', [
    { type: 'turn/start', data: { turn: 1 }, time: T0 },
    editCall(1),
    bashCall(1, 'ls -la'),
    assistantTurn(1, '改好了'),
  ])
  assert.equal(analyzeSession(events).totals.closureRate, 0)
})

test('claims inside quotes, code and tables are not counted', () => {
  assert.deepEqual(findClaims('他说「已经完成」了'), [])
  assert.deepEqual(findClaims('```\n// 已完成\n```'), [])
  assert.deepEqual(findClaims('| 已完成 | 说明 |'), [])
  assert.deepEqual(findClaims('已完成，测试通过'), ['已完成'])
})

test('summarize splits arms and builds a daily series', () => {
  const withSession = analyzeSession(sessionEvents('<coding_discipline>', [
    { type: 'turn/start', data: { turn: 1 }, time: T0 },
    editCall(1),
    bashCall(1, 'ctest'),
    assistantTurn(1, '跑通'),
  ]))
  const withoutSession = analyzeSession(sessionEvents('plain', [
    { type: 'turn/start', data: { turn: 1 }, time: T0 + 86_400_000 },
    editCall(1),
    assistantTurn(1, '改好了'),
  ]))
  const summary = summarize([withSession, withoutSession])
  assert.equal(summary.arms.with.closureRate, 1)
  assert.equal(summary.arms.without.closureRate, 0)
  assert.equal(summary.daily.length, 2)
  assert.deepEqual(summary.daily.map((day) => day.editTurns), [1, 1])
})

test('zstd frames decode when several are concatenated', () => {
  const first = zstdCompressSync(Buffer.from('{"type":"session","id":"a"}\n'))
  const second = zstdCompressSync(Buffer.from('{"type":"turn/start","data":{"turn":1}}\n'))
  const text = decodeZstdFrames(Buffer.concat([first, second]))
  assert.ok(text.includes('"type":"session"'))
  assert.ok(text.includes('"turn":1'))
})

test('session discovery and reading round-trip through a real file', () => {
  const root = mkdtempSync(join(tmpdir(), 'cd-sessions-'))
  const sessionDir = join(root, 'session-abc')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, SESSION_FILE), zstdCompressSync(Buffer.from('{"type":"session","id":"abc"}\n')))

  const files = listSessionFiles(root)
  assert.equal(files.length, 1)
  const events = readSessionEvents(files[0].file)
  assert.equal(events[0].id, 'abc')
})

test('the rendered page carries the headline numbers and no placeholders', () => {
  const session = analyzeSession(sessionEvents('plain', [
    { type: 'turn/start', data: { turn: 1 }, time: T0 },
    editCall(1),
    bashCall(1, 'pytest -q'),
    assistantTurn(1, '修好了'),
  ]))
  const html = renderDashboard(summarize([session]), { source: 'C:/sessions', now: T0 })
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('改动-验证闭环率'))
  assert.ok(html.includes('100%'))
  assert.ok(!html.includes('undefined'))
})

test('the route handler answers GET with HTML and rejects POST', async () => {
  const statuses = []
  const handler = createDashboardHandler({ render: () => '<!doctype html><p>ok</p>' })
  const fakeRes = { writeHead: (status) => statuses.push(status), end: () => {} }
  await handler({ method: 'GET' }, fakeRes)
  await handler({ method: 'POST' }, fakeRes)
  assert.deepEqual(statuses, [200, 405])
})

test('the page factory caches within its ttl and notes an empty root', () => {
  const page = createDashboardPage({ root: mkdtempSync(join(tmpdir(), 'cd-empty-')), ttlMs: 1000, now: () => 0 })
  const first = page()
  const second = page()
  assert.equal(first, second)
  assert.ok(first.includes('coding-discipline'))
  assert.equal(ROUTE_PATH, '/coding-discipline')
})

test('registerDashboard registers a prefix route on the host web server', () => {
  /** @type {any[]} */
  const routes = []
  const ctx = {
    inject: (_deps, callback) => callback({
      get: (name) => (name === 'webServer' ? { register: (route) => { routes.push(route); return () => {} } } : undefined),
      effect: (install) => install(),
    }),
  }
  registerDashboard(ctx, {})
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, ROUTE_PATH)
  assert.equal(typeof routes[0].handler, 'function')
})

test('registerDashboard stays quiet when the composition has no web server', () => {
  let warned = ''
  const ctx = {
    inject: (_deps, callback) => callback({ get: () => undefined }),
    logger: { warn: (message) => { warned = message } },
  }
  assert.doesNotThrow(() => registerDashboard(ctx, {}))
  assert.equal(warned, '')
})
