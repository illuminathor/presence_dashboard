import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Db } from './db.js'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
const SESSION_MS = 30 * 24 * 3600_000

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

const DUMMY = hashPassword('dummy-password-for-timing')
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  const [, saltHex, keyHex] = (stored ?? await DUMMY).split('$')
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64)
  const want = Buffer.from(keyHex, 'hex')
  return stored !== null && key.length === want.length && timingSafeEqual(key, want)
}

export interface User { id: number; email: string; role: 'admin' | 'viewer' }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export function createSession(db: Db, userId: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url')
  db.prepare('insert into sessions (token_hash, user_id, expires_at) values (?,?,?)').run(sha(token), userId, now + SESSION_MS)
  return token
}
export function userFromToken(db: Db, token: string | undefined, now = Date.now()): User | null {
  if (!token) return null
  const u = db.prepare(`select u.id, u.email, u.role from sessions s join users u on u.id = s.user_id
    where s.token_hash = ? and s.expires_at > ?`).get(sha(token), now) as User | undefined
  return u ?? null
}
export const destroySession = (db: Db, token: string) => { db.prepare('delete from sessions where token_hash = ?').run(sha(token)) }
export const purgeSessions = (db: Db, now = Date.now()) => { db.prepare('delete from sessions where expires_at <= ?').run(now) }

export const SESSION_SECONDS = SESSION_MS / 1000
export const MIN_PASSWORD = 8

export async function addUser(db: Db, email: string, password: string, role: 'admin' | 'viewer'): Promise<User> {
  const hash = await hashPassword(password)
  const r = db.prepare('insert into users (email, password_hash, role, created_at) values (?,?,?,?)').run(email.trim(), hash, role, Date.now())
  return { id: Number(r.lastInsertRowid), email: email.trim(), role }
}
export async function setPassword(db: Db, userId: number, password: string) {
  db.prepare('update users set password_hash = ? where id = ?').run(await hashPassword(password), userId)
  db.prepare('delete from sessions where user_id = ?').run(userId) // paksa login ulang
}
