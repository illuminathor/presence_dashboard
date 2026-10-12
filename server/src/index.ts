import { purgeSessions } from './auth.js'
import { openDb } from './db.js'
import { MqttManager } from './mqttManager.js'
import { createApp } from './server.js'

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '127.0.0.1'

const db = openDb(process.env.DB_FILE ?? './data/presence.db')
const mqttMgr = new MqttManager(db)
const server = createApp(db, mqttMgr, process.env.WEB_DIR ?? '../web/dist')

purgeSessions(db)
setInterval(() => purgeSessions(db), 3600_000).unref()

server.listen(PORT, HOST, () => log(`server di http://${HOST}:${PORT}`))
void mqttMgr.apply()
mqttMgr.startRetry()

function shutdown() {
  log('berhenti…')
  mqttMgr.stop()
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
