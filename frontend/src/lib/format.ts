// Number, currency and date formatting that follows the organisation settings (BRD Section 7, Localisation).

export interface OrgSettings {
  organisation: string
  currency: string
  currency_symbol: string
  number_format: 'lakh' | 'international'
  date_format: string
  timezone: string
  language: string
  fiscal_year_start: number
  measurement_unit: string
  prefixes: Record<string, string>
  optional_stages: Record<string, boolean>
  stage_limit_days: Record<string, number>
  weights: Record<string, number>
  thresholds: { on_track: number; watch: number }
}

let settings: Partial<OrgSettings> = { number_format: 'lakh', currency_symbol: '৳', timezone: 'Asia/Dhaka', measurement_unit: 'in' }
export const applySettings = (s: Partial<OrgSettings>) => { settings = { ...settings, ...s } }
export const currentSettings = () => settings

const locale = () => (settings.number_format === 'lakh' ? 'en-IN' : 'en-US')

/** 1850000 -> "18,50,000" (lakh grouping) or "1,850,000". */
export function num(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)
}

/** Full amount with currency symbol: "৳ 18,50,000". */
export function money(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${settings.currency_symbol ?? ''} ${num(v, decimals)}`.trim()
}

/** Compact amount for cards and charts: "92.53 L", "1.25 Cr" (lakh format) or "1.85 M". */
export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  if (settings.number_format === 'lakh') {
    if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`
    if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`
    return num(v)
  }
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)} K`
  return num(v)
}

export const compactMoney = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${settings.currency_symbol ?? ''} ${compact(v)}`.trim())

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = MONTHS

function parts(iso: string): { y: number; m: number; d: number; hh: string; mm: string } | null {
  if (!iso) return null
  if (iso.length <= 10) {
    const [y, m, d] = iso.split('-').map(Number)
    return { y, m, d, hh: '', mm: '' }
  }
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return null
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  const p: Record<string, string> = {}
  f.formatToParts(dt).forEach((x) => { p[x.type] = x.value })
  return { y: +p.year, m: +p.month, d: +p.day, hh: p.hour === '24' ? '00' : p.hour, mm: p.minute }
}

/** Dates always use the organisation's date format, DD-MMM-YYYY by default (BR-26). */
export function fmtDate(iso?: string | null): string {
  const p = iso ? parts(iso) : null
  if (!p) return '—'
  const dd = String(p.d).padStart(2, '0')
  const f = settings.date_format || 'DD-MMM-YYYY'
  if (f === 'DD/MM/YYYY') return `${dd}/${String(p.m).padStart(2, '0')}/${p.y}`
  if (f === 'YYYY-MM-DD') return `${p.y}-${String(p.m).padStart(2, '0')}-${dd}`
  if (f === 'MM/DD/YYYY') return `${String(p.m).padStart(2, '0')}/${dd}/${p.y}`
  return `${dd}-${MONTHS[p.m - 1]}-${p.y}`
}

export function fmtDateTime(iso?: string | null): string {
  const p = iso ? parts(iso) : null
  if (!p) return '—'
  return p.hh ? `${fmtDate(iso)}, ${p.hh}:${p.mm}` : fmtDate(iso)
}

/** Today's date in the browser as YYYY-MM-DD (for date inputs). */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function hoursLabel(h?: number | null): string {
  if (h === null || h === undefined) return '—'
  if (h < 1) return '< 1 h'
  if (h < 24) return `${Math.round(h)} h`
  const d = h / 24
  return `${d >= 10 ? Math.round(d) : d.toFixed(1).replace('.0', '')} d`
}

export const pct = (v?: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`)

export function dims(h?: number | null, w?: number | null, l?: number | null): string {
  if (!h && !w && !l) return '—'
  return `${h ?? '—'} / ${w ?? '—'} / ${l ?? '—'} ${settings.measurement_unit ?? 'in'}`
}

// ---------- reporting periods (Monthly / Quarterly / Yearly) ----------
export type PeriodMode = 'monthly' | 'quarterly' | 'yearly'
export interface Period { mode: PeriodMode; year: number; period: number }

export function currentPeriod(mode: PeriodMode = 'monthly'): Period {
  const d = new Date()
  const fy = settings.fiscal_year_start || 1
  const m = d.getMonth() + 1
  if (mode === 'monthly') return { mode, year: d.getFullYear(), period: m }
  const fyYear = m >= fy ? d.getFullYear() : d.getFullYear() - 1
  if (mode === 'yearly') return { mode, year: fyYear, period: 1 }
  return { mode, year: fyYear, period: Math.floor(((m - fy + 12) % 12) / 3) + 1 }
}

/** First and last day (YYYY-MM-DD) of a reporting period, for list filters. */
export function periodRange(p: Period): { from: string; to: string } {
  const fy = settings.fiscal_year_start || 1
  let startM: number, count: number
  if (p.mode === 'monthly') { startM = p.period; count = 1 } else if (p.mode === 'quarterly') { startM = fy + 3 * (p.period - 1); count = 3 } else { startM = fy; count = 12 }
  const sy = p.year + Math.floor((startM - 1) / 12)
  const sm = ((startM - 1) % 12) + 1
  const endIdx = startM + count - 1
  const ey = p.year + Math.floor((endIdx - 1) / 12)
  const em = ((endIdx - 1) % 12) + 1
  const last = new Date(ey, em, 0).getDate()
  const z = (n: number) => String(n).padStart(2, '0')
  return { from: `${sy}-${z(sm)}-01`, to: `${ey}-${z(em)}-${z(last)}` }
}

export function periodLabel(p: Period): string {
  if (p.mode === 'monthly') return `${MONTHS[p.period - 1]} ${p.year}`
  if (p.mode === 'quarterly') return `Q${p.period} ${p.year}`
  return `${p.year}`
}
