import { tx, type Db } from './db.js'
import { notifyChange } from './bus.js'

interface Row { id: number; status: 'occupied' | 'vacant'; ts: number }

/**
 * Simpan satu event. Dedup (device, ts, status). is_transition dihitung ulang di sekitar baris
 * yang disisipkan, jadi event yang datang terlambat tetap masuk di posisi yang benar.
 */
export function ingestEvent(db: Db, device: string, ts: number, status: 'occupied' | 'vacant', raw: unknown, suspect: boolean, now = Date.now()): boolean {
  const inserted = tx(db, () => {
    db.prepare('insert or ignore into devices (device_id, created_at) values (?, ?)').run(device, now)
    const r = db.prepare('insert or ignore into events (device_id, ts, status, ts_suspect, received_at, raw) values (?,?,?,?,?,?)')
      .run(device, ts, status, suspect ? 1 : 0, now, raw === undefined ? null : JSON.stringify(raw))
    if (r.changes === 0) return false
    const id = Number(r.lastInsertRowid)

    const prev = db.prepare('select status from events where device_id = ? and (ts, id) < (?, ?) order by ts desc, id desc limit 1')
      .get(device, ts, id) as { status: string } | undefined
    db.prepare('update events set is_transition = ? where id = ?').run(prev?.status !== status ? 1 : 0, id)

    const next = db.prepare('select id, status from events where device_id = ? and (ts, id) > (?, ?) order by ts, id limit 1')
      .get(device, ts, id) as { id: number; status: string } | undefined
    if (next) db.prepare('update events set is_transition = ? where id = ?').run(next.status !== status ? 1 : 0, next.id)

    const latest = db.prepare('select id, status, ts from events where device_id = ? order by ts desc, id desc limit 1')
      .get(device) as unknown as Row
    const since = (db.prepare('select max(ts) as m from events where device_id = ? and is_transition = 1 and ts <= ?')
      .get(device, latest.ts) as { m: number | null }).m
    db.prepare(`insert into device_status (device_id, current_status, since, last_seen) values (?,?,?,?)
      on conflict (device_id) do update set current_status = excluded.current_status, since = excluded.since,
        last_seen = max(coalesce(device_status.last_seen, 0), excluded.last_seen)`)
      .run(device, latest.status, since, now)
    return true
  })
  if (inserted) notifyChange(device)
  return inserted
}

export function setDeviceOnline(db: Db, device: string, online: boolean, now = Date.now()) {
  tx(db, () => {
    db.prepare('insert or ignore into devices (device_id, created_at) values (?, ?)').run(device, now)
    const last = db.prepare('select online from device_online_log where device_id = ? order by ts desc, id desc limit 1')
      .get(device) as { online: number } | undefined
    if (!last || (last.online === 1) !== online) {
      db.prepare('insert into device_online_log (device_id, online, ts) values (?,?,?)').run(device, online ? 1 : 0, now)
    }
    db.prepare('insert into device_status (device_id, online) values (?, ?) on conflict (device_id) do update set online = excluded.online')
      .run(device, online ? 1 : 0)
  })
  notifyChange(device)
}
