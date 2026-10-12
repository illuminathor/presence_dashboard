import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Job =
  | { t: 'event'; device: string; ts: string; status: string; raw: unknown; suspect: boolean }
  | { t: 'online'; device: string; online: boolean }

/** Antrean JSONL di disk: bertahan saat Supabase tak terjangkau atau proses restart. */
export class DiskQueue {
  private items: Job[] = []
  constructor(private file: string, private max = 50_000) {
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file)) {
      for (const l of readFileSync(file, 'utf8').split('\n')) {
        if (!l) continue
        try { this.items.push(JSON.parse(l)) } catch { /* baris rusak dibuang */ }
      }
    }
  }
  get length() { return this.items.length }
  peek(): Job | undefined { return this.items[0] }
  push(j: Job) {
    if (this.items.length >= this.max) { this.items.shift(); this.rewrite() }
    this.items.push(j)
    appendFileSync(this.file, JSON.stringify(j) + '\n')
  }
  shift() {
    this.items.shift()
    // tulis ulang hanya sesekali supaya tidak berat; antrean kosong -> kosongkan file
    if (this.items.length === 0) writeFileSync(this.file, '')
    else if (++this.shifts % 200 === 0) this.rewrite()
  }
  private shifts = 0
  private rewrite() { writeFileSync(this.file, this.items.map((i) => JSON.stringify(i)).join('\n') + (this.items.length ? '\n' : '')) }
}
