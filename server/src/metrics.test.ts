import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from './db.js'
import { ingestEvent, setDeviceOnline } from './ingest.js'
import { getBuckets, getSummary, getTimeline, subtract } from './metrics.js'

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 12, 0, 0, 0)
const NOW = T0 + 10 * H
const mk = () => openDb(':memory:')
const trans = (db: ReturnType<typeof mk>) =>
  (db.prepare('select ts, status, is_transition as t from events order by ts, id').all() as { ts: number; status: string; t: number }[]).map((r) => `${(r.ts - T0) / H}${r.status[0]}${r.t}`)

test('subtract', () => {
  assert.deepEqual(subtract([[0, 10]], [[2, 4], [6, 8]]), [[0, 2], [4, 6], [8, 10]])
  assert.deepEqual(subtract([[0, 10]], [[0, 10]]), [])
  assert.deepEqual(subtract([[0, 5], [8, 12]], [[4, 9]]), [[0, 4], [9, 12]])
})

test('dedup dan heartbeat bukan transisi', () => {
  const db = mk()
  assert.equal(ingestEvent(db, 'a', T0 + H, 'occupied', {}, false, NOW), true)
  assert.equal(ingestEvent(db, 'a', T0 + H, 'occupied', {}, false, NOW), false)
  ingestEvent(db, 'a', T0 + 2 * H, 'occupied', {}, false, NOW)
  ingestEvent(db, 'a', T0 + 3 * H, 'vacant', {}, false, NOW)
  assert.deepEqual(trans(db), ['1o1', '2o0', '3v1'])
})

test('event terlambat menghitung ulang transisi di sekitarnya', () => {
  const db = mk()
  ingestEvent(db, 'a', T0 + 1 * H, 'occupied', {}, false, NOW)
  ingestEvent(db, 'a', T0 + 3 * H, 'vacant', {}, false, NOW)
  ingestEvent(db, 'a', T0 + 2 * H, 'vacant', {}, false, NOW) // datang terlambat
  assert.deepEqual(trans(db), ['1o1', '2v1', '3v0'])
  const st = db.prepare('select current_status, since from device_status').get() as { current_status: string; since: number }
  assert.equal(st.current_status, 'vacant'); assert.equal(st.since, T0 + 2 * H)
})

test('summary: hitungan transisi, offline dikecualikan, periode sebelumnya', () => {
  const db = mk()
  // periode sebelumnya (T0-4h..T0): 1 transisi terisi
  ingestEvent(db, 'a', T0 - 2 * H, 'occupied', {}, false, NOW)
  ingestEvent(db, 'a', T0 - 1 * H, 'vacant', {}, false, NOW)
  // periode ini T0..T0+4h: terisi 1h–3h; heartbeat 2h
  ingestEvent(db, 'a', T0 + 1 * H, 'occupied', {}, false, NOW)
  ingestEvent(db, 'a', T0 + 2 * H, 'occupied', {}, false, NOW)
  ingestEvent(db, 'a', T0 + 3 * H, 'vacant', {}, false, NOW)
  // offline 2.5h–3.5h (mengurangi 0.5h terisi dan 1h dari window)
  setDeviceOnline(db, 'a', false, T0 + 2.5 * H)
  setDeviceOnline(db, 'a', true, T0 + 3.5 * H)
  const s = getSummary(db, 'a', T0, T0 + 4 * H, NOW)
  assert.equal(s.current.occupied_count, 1)
  assert.equal(s.current.vacant_count, 1)
  assert.equal(s.current.offline_seconds, 3600)
  assert.equal(s.current.occupied_seconds, 1.5 * 3600)
  assert.equal(s.current.window_seconds, 4 * 3600)
  assert.equal(s.current.occupancy_rate, 50) // 1.5h / (4h-1h)
  assert.equal(s.prev.occupied_count, 1)
  assert.equal(s.prev.vacant_count, 1)
  assert.equal(s.prev.occupied_seconds, 3600) // −2h..−1h
})

test('window dipotong ke sekarang, timeline berisi offline', () => {
  const db = mk()
  ingestEvent(db, 'a', T0 + 1 * H, 'occupied', {}, false, NOW)
  setDeviceOnline(db, 'a', false, T0 + 2 * H)
  const to = T0 + 20 * H // di masa depan
  const s = getSummary(db, 'a', T0, to, NOW)
  assert.equal(s.current.window_seconds, 10 * 3600)
  assert.equal(s.current.offline_seconds, 8 * 3600) // offline 2h..now(10h)
  const tl = getTimeline(db, 'a', T0, to, NOW)
  assert.deepEqual(tl.map((x) => [x.kind, (x.start - T0) / H, (x.end - T0) / H]), [['occupied', 1, 2], ['offline', 2, 10]])
})

test('buckets', () => {
  const db = mk()
  ingestEvent(db, 'a', T0 + 0.5 * H, 'occupied', {}, false, NOW)
  ingestEvent(db, 'a', T0 + 2.5 * H, 'vacant', {}, false, NOW)
  const b = getBuckets(db, 'a', T0, T0 + 4 * H, H)
  assert.deepEqual(b.map((x) => [x.occupied, x.vacant]), [[1, 0], [0, 0], [0, 1], [0, 0]])
  assert.throws(() => getBuckets(db, 'a', T0, T0 + 4 * H, 1000))
})
