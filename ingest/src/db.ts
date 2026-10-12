// Klien PostgREST minimal (fetch) — tanpa supabase-js agar hemat memori.
const URL_BASE = () => process.env.SUPABASE_URL!.replace(/\/$/, '')
// Secret key baru (sb_secret_...) bukan JWT: kirim lewat header apikey saja.
// Key legacy service_role (JWT, eyJ...) tetap didukung dan butuh Authorization Bearer.
const KEY = () => (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!

/** Error permanen (data/izin salah, 4xx) — jangan di-retry. Error jaringan/5xx -> retry. */
export class PermanentError extends Error {}

async function call(path: string, init: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${URL_BASE()}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: KEY(), ...(KEY().startsWith('eyJ') ? { Authorization: `Bearer ${KEY()}` } : {}),
        'Content-Type': 'application/json', Prefer: 'return=representation',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    throw new Error(`jaringan: ${(e as Error).message}`)
  }
  const text = await res.text()
  if (!res.ok) {
    const msg = `HTTP ${res.status}: ${text.slice(0, 300)}`
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new PermanentError(msg)
    throw new Error(msg)
  }
  return text ? JSON.parse(text) : null
}

export const rpc = (fn: string, args: object) => call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
export const select = <T>(table: string, query = '') => call(`${table}?${query}`, { method: 'GET' }) as Promise<T[]>
export const patch = (table: string, query: string, body: object) =>
  call(`${table}?${query}`, { method: 'PATCH', body: JSON.stringify(body) })
export const del = (table: string, query: string) => call(`${table}?${query}`, { method: 'DELETE' })
