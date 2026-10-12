// REST client for the Athena OS API. Every call sends the session token.

const TOKEN_KEY = 'athena.token'

export class ApiError extends Error {
  status: number
  code?: string
  /** field name -> message, for inline form errors */
  fields?: Record<string, string>
  /** row-by-row messages from imports */
  rows?: string[]
  data?: any
  constructor(status: number, message: string, data?: any) {
    super(message)
    this.status = status
    this.data = data
    if (data && typeof data === 'object') {
      this.code = data.code
      this.fields = data.fields
      this.rows = data.rows
    }
  }
}

export const getToken = () => sessionStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY))

let onUnauthorized: (message: string) => void = () => {}
export const setUnauthorizedHandler = (fn: (message: string) => void) => { onUnauthorized = fn }

async function request<T = any>(method: string, path: string, body?: any, isForm = false): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'Not saved, please try again. The connection to the server was lost.')
  }
  if (res.ok) return res.status === 204 ? (undefined as T) : res.json()
  let detail: any = null
  try { detail = (await res.json()).detail } catch { /* not JSON */ }
  const message = typeof detail === 'string' ? detail
    : detail?.message ?? (Array.isArray(detail) ? 'Please check the values entered.' : `Request failed (${res.status}).`)
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null)
    onUnauthorized(message)
  }
  throw new ApiError(res.status, message, typeof detail === 'object' ? detail : undefined)
}

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, any>): string {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== 0) p.set(k, String(v)) })
  const s = p.toString()
  return s ? `?${s}` : ''
}

const blobCache = new Map<string, Promise<string>>()

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body: any = {}) => request<T>('POST', path, body),
  put: <T = any>(path: string, body: any = {}) => request<T>('PUT', path, body),
  /** Upload one image; returns the stored file name. */
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ file: string; name: string }>('POST', '/files', form, true)
  },
  /** Files are served only to signed-in users, so images are fetched with the token and shown as blob URLs. */
  fileUrl: (name: string): Promise<string> => {
    let p = blobCache.get(name)
    if (!p) {
      p = fetch(`/api/files/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${getToken()}` } })
        .then((r) => { if (!r.ok) throw new Error('not found'); return r.blob() })
        .then((b) => URL.createObjectURL(b))
      p.catch(() => blobCache.delete(name))
      blobCache.set(name, p)
    }
    return p
  },
}
