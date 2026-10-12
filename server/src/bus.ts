import { EventEmitter } from 'node:events'

/** Pemberitahuan "data berubah" untuk dashboard (SSE). */
export const bus = new EventEmitter()
bus.setMaxListeners(100)
export const notifyChange = (device: string) => bus.emit('change', device)
