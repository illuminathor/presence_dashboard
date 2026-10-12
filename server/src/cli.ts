// Kelola user dari server (tanpa web). Contoh:
//   npm run user -- add admin@contoh.com admin        (password acak dicetak)
//   npm run user -- add budi@contoh.com viewer 'passwordku123'
//   npm run user -- passwd budi@contoh.com
//   npm run user -- list
import { randomBytes } from 'node:crypto'
import { addUser, MIN_PASSWORD, setPassword } from './auth.js'
import { openDb } from './db.js'

const db = openDb(process.env.DB_FILE ?? './data/presence.db')
const [cmd, email, a3, a4] = process.argv.slice(2)
const gen = () => randomBytes(12).toString('base64url')

async function main() {
  if (cmd === 'list') {
    for (const u of db.prepare('select email, role from users order by id').all() as { email: string; role: string }[]) console.log(`${u.role.padEnd(7)} ${u.email}`)
  } else if (cmd === 'add' && email) {
    const role = a3 === 'admin' ? 'admin' : 'viewer'
    const pw = a4 ?? gen()
    if (pw.length < MIN_PASSWORD) throw new Error(`Password minimal ${MIN_PASSWORD} karakter`)
    await addUser(db, email, pw, role)
    console.log(`User dibuat: ${email} (${role})${a4 ? '' : `\nPassword: ${pw}`}`)
  } else if (cmd === 'passwd' && email) {
    const u = db.prepare('select id from users where email = ?').get(email) as { id: number } | undefined
    if (!u) throw new Error('User tidak ditemukan')
    const pw = a3 ?? gen()
    if (pw.length < MIN_PASSWORD) throw new Error(`Password minimal ${MIN_PASSWORD} karakter`)
    await setPassword(db, u.id, pw)
    console.log(`Password ${email} diganti${a3 ? '' : `\nPassword baru: ${pw}`}`)
  } else {
    console.log('Pemakaian: user add <email> [admin|viewer] [password] | user passwd <email> [password] | user list')
    process.exitCode = 1
  }
}
main().catch((e) => { console.error(e.message.includes('UNIQUE') ? 'Email sudah terdaftar' : e.message); process.exitCode = 1 })
