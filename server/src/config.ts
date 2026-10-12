import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import type { IClientOptions } from 'mqtt'

export interface MqttCfg {
  host: string; port: number; protocol: 'mqtt' | 'mqtts' | 'ws' | 'wss'
  username?: string | null; password?: string | null
  topic_status: string; topic_online?: string | null
}

export const cfgKey = (c: MqttCfg & { updated_at?: number }) => JSON.stringify([c.host, c.port, c.protocol, c.username, c.topic_status, c.topic_online, c.updated_at])

export const brokerUrl = (c: MqttCfg) =>
  `${c.protocol}://${c.host}:${c.port}${c.protocol === 'ws' || c.protocol === 'wss' ? '/mqtt' : ''}`

/** Client ID stabil agar sesi persisten (clean=false) dikenali broker setelah restart. */
export const stableClientId = () =>
  'presence-ingest-' + createHash('sha1').update(hostname()).digest('hex').slice(0, 10)

export function connectOpts(c: MqttCfg, o: { persistent: boolean; clientId: string }): IClientOptions {
  return {
    clientId: o.clientId,
    username: c.username || undefined,
    password: c.password || undefined,
    clean: !o.persistent,
    reconnectPeriod: 3000,
    connectTimeout: 10_000,
    keepalive: 30,
    resubscribe: true,
  }
}
