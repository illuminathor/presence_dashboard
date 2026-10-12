import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceIdFromTopic, parseOnlinePayload, parseStatusPayload, topicMatches } from './parse.js'

const NOW = 1_791_810_400_000

test('payload valid', () => {
  const r = parseStatusPayload('{"ts":1791810396000,"status":"occupied"}', NOW)
  assert.ok(r.ok && r.status === 'occupied' && !r.suspect)
})
test('status di luar enum ditolak', () => {
  assert.equal(parseStatusPayload('{"ts":1,"status":"x"}', NOW).ok, false)
})
test('bukan JSON ditolak', () => assert.equal(parseStatusPayload('hello', NOW).ok, false))
test('ts kosong -> waktu terima', () => {
  const r = parseStatusPayload('{"status":"vacant"}', NOW)
  assert.ok(r.ok && r.ts.getTime() === NOW)
})
test('clock skew > 5 menit -> suspect', () => {
  const r = parseStatusPayload(`{"ts":${NOW - 6 * 60_000},"status":"vacant"}`, NOW)
  assert.ok(r.ok && r.suspect)
})
test('device id dari topic', () => {
  assert.equal(deviceIdFromTopic('presence/+/status', 'presence/ruang-a/status'), 'ruang-a')
  assert.equal(deviceIdFromTopic('presence/status', 'presence/status'), 'default')
})
test('topic match', () => {
  assert.ok(topicMatches('presence/+/status', 'presence/a/status'))
  assert.ok(!topicMatches('presence/+/status', 'presence/a/online'))
  assert.ok(topicMatches('presence/#', 'presence/a/b'))
})
test('payload online', () => {
  assert.equal(parseOnlinePayload('true'), true)
  assert.equal(parseOnlinePayload('false'), false)
  assert.equal(parseOnlinePayload('?'), null)
})
