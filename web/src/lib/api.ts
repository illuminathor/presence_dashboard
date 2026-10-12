export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method, credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch { throw new ApiError(0, 'Tidak dapat menghubungi server.') }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* bukan JSON */ }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Error ${res.status}`)
  return data as T
}
export const get = <T,>(path: string) => api<T>('GET', path)
