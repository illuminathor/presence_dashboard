import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
create table if not exists users (
  id integer primary key autoincrement,
  email text not null unique collate nocase,
  password_hash text not null,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  created_at integer not null
);
create table if not exists sessions (
  token_hash text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at integer not null
);
create table if not exists devices (
  device_id text primary key,
  room_name text,
  created_at integer not null
);
create table if not exists events (
  id integer primary key autoincrement,
  device_id text not null references devices(device_id) on delete cascade,
  ts integer not null,
  status text not null check (status in ('occupied','vacant')),
  is_transition integer not null default 0,
  ts_suspect integer not null default 0,
  received_at integer not null,
  raw text,
  unique (device_id, ts, status)
);
create index if not exists events_device_ts on events (device_id, ts);
create index if not exists events_transition on events (device_id, ts) where is_transition = 1;
create table if not exists device_status (
  device_id text primary key references devices(device_id) on delete cascade,
  current_status text check (current_status in ('occupied','vacant')),
  since integer,
  online integer not null default 1,
  last_seen integer
);
create table if not exists device_online_log (
  id integer primary key autoincrement,
  device_id text not null references devices(device_id) on delete cascade,
  online integer not null,
  ts integer not null
);
create index if not exists online_log_device_ts on device_online_log (device_id, ts);
create table if not exists settings (
  key text primary key,
  value text not null
);
create table if not exists mqtt_config (
  id integer primary key check (id = 1),
  host text not null,
  port integer not null,
  protocol text not null check (protocol in ('mqtt','mqtts','ws','wss')),
  username text,
  password text,
  topic_status text not null,
  topic_online text,
  updated_at integer not null
);
`

export type Db = DatabaseSync

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;')
  db.exec(SCHEMA)
  // berisi password MQTT dan hash password user: hanya pemilik yang boleh baca
  if (file !== ':memory:') try { chmodSync(file, 0o600) } catch { /* abaikan */ }
  return db
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}
