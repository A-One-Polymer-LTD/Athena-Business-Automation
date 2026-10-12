// Athena OS design system: shared building blocks used by every screen.
import { AlertTriangle, CheckCircle2, ChevronDown, Inbox, Loader2, X, XCircle } from 'lucide-react'
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { ApiError } from '../lib/api'
import { MONTH_NAMES, type Period, type PeriodMode, currentPeriod, currentSettings } from '../lib/format'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

// ---------------------------------------------------------------- buttons
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'gold'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-800 text-white hover:bg-brand-700 shadow-sm disabled:bg-slate-300 disabled:text-slate-500',
  secondary: 'bg-white text-brand-900 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:text-slate-400 disabled:bg-slate-50',
  ghost: 'text-brand-800 hover:bg-brand-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-slate-300 disabled:text-slate-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:bg-slate-300 disabled:text-slate-500',
  gold: 'bg-gold-400 text-brand-950 hover:bg-gold-300 shadow-sm disabled:bg-slate-300 disabled:text-slate-500',
}
const SIZES = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-[15px] gap-2' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: keyof typeof SIZES
  loading?: boolean
  icon?: ReactNode
}
/** Buttons are disabled while `loading` to prevent double submission (BRD 8.9). */
export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors select-none', VARIANTS[variant], SIZES[size], className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- layout pieces
export function PageHeader({ title, subtitle, actions, code }: { title: string; subtitle?: ReactNode; actions?: ReactNode; code?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 no-print">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-brand-950">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, subtitle, actions, children, className, padded = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-card', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <div>
            {title && <h2 className="text-[15px] font-bold text-brand-950">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center justify-between gap-2">
      <h2 className="border-l-4 border-gold-400 pl-3 text-[13px] font-bold uppercase tracking-wider text-brand-900">{children}</h2>
      {action}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin text-brand-600" /> <span>{label}</span>
    </div>
  )
}

export function Empty({ title = 'Nothing to show yet', hint, action, icon }: { title?: string; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="font-semibold text-brand-950">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorNote({ error, className }: { error?: string | null; className?: string }) {
  if (!error) return null
  return (
    <div role="alert" className={cx('flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800', className)}>
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
    </div>
  )
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'success'; children: ReactNode; className?: string }) {
  const tones = { info: 'border-brand-200 bg-brand-50 text-brand-900', warn: 'border-orange-200 bg-orange-50 text-orange-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
  return <div className={cx('rounded-lg border px-3.5 py-2.5 text-sm', tones[tone], className)}>{children}</div>
}

// ---------------------------------------------------------------- status badges (BRD 10.4: colour AND text)
const BADGE: Record<string, string> = {
  Draft: 'border border-slate-400 text-slate-600 bg-white',
  Pending: 'bg-slate-200 text-slate-700',
  Unassigned: 'bg-slate-200 text-slate-700',
  Returned: 'bg-orange-100 text-orange-800 border border-orange-300',
  Submitted: 'bg-brand-100 text-brand-800',
  'In Progress': 'bg-brand-100 text-brand-800',
  'In Production': 'bg-blue-100 text-blue-800',
  'At QC': 'border border-emerald-500 text-emerald-700 bg-white',
  Rework: 'bg-red-100 text-red-700',
  Delayed: 'bg-orange-100 text-orange-800',
  Completed: 'bg-gold-100 text-gold-700',
  'Finish Good': 'bg-gold-100 text-gold-700',
  'In Warehouse': 'bg-gold-100 text-gold-700',
  Packed: 'bg-gold-100 text-gold-700',
  'Ready for Delivery': 'bg-teal-100 text-teal-800',
  Delivered: 'bg-brand-800 text-white',
  'Partly Delivered': 'bg-brand-100 text-brand-800 border border-brand-300',
  Cancelled: 'bg-slate-100 text-slate-500 line-through',
  'On Track': 'bg-emerald-100 text-emerald-800',
  Watch: 'bg-amber-100 text-amber-800',
  Critical: 'bg-red-100 text-red-700',
  Open: 'bg-blue-100 text-blue-800',
  'Closed Won': 'bg-emerald-100 text-emerald-800',
  'Closed Lost': 'bg-slate-200 text-slate-600',
  Generated: 'bg-brand-800 text-white',
  Revised: 'bg-purple-100 text-purple-800',
  Incomplete: 'bg-orange-100 text-orange-800',
  Issued: 'bg-emerald-100 text-emerald-800',
  'Partly Issued': 'bg-amber-100 text-amber-800',
  Pass: 'bg-emerald-100 text-emerald-800',
  Active: 'bg-emerald-100 text-emerald-800',
  Inactive: 'bg-slate-200 text-slate-600',
  Retired: 'bg-slate-200 text-slate-600',
  Locked: 'bg-slate-700 text-white',
  Voided: 'bg-slate-200 text-slate-500 line-through',
  'No target': 'bg-slate-100 text-slate-500',
}
const STAGE_BLUE = 'bg-blue-100 text-blue-800'

/** Coloured badge with text for any status or production stage. Unknown values (stage names) show in blue. */
export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE[status] ?? STAGE_BLUE, className)}>
      {status}
    </span>
  )
}

export function Pill({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'brand' | 'gold' | 'red' | 'green' | 'orange'; className?: string }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', brand: 'bg-brand-100 text-brand-800', gold: 'bg-gold-100 text-gold-700', red: 'bg-red-100 text-red-700', green: 'bg-emerald-100 text-emerald-800', orange: 'bg-orange-100 text-orange-800' }
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>
}

// ---------------------------------------------------------------- KPI cards and progress
export function StatCard({ label, value, hint, icon, tone = 'brand', onClick, active }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'gold' | 'green' | 'red' | 'orange' | 'slate' | 'teal'; onClick?: () => void; active?: boolean
}) {
  const tones = { brand: 'bg-brand-50 text-brand-700', gold: 'bg-gold-50 text-gold-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', orange: 'bg-orange-50 text-orange-600', slate: 'bg-slate-100 text-slate-600', teal: 'bg-teal-50 text-teal-600' }
  const Tag: any = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} type={onClick ? 'button' : undefined}
      className={cx('flex w-full items-start justify-between gap-3 rounded-xl border bg-white p-4 text-left shadow-card transition', active ? 'border-brand-600 ring-2 ring-brand-200' : 'border-slate-200', onClick && 'hover:border-brand-400 hover:shadow-md')}>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-1.5 truncate font-display text-2xl font-bold tabular text-brand-950">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
      {icon && <div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', tones[tone])}>{icon}</div>}
    </Tag>
  )
}

/** Colour of an achievement value against the organisation's thresholds (BR-21). */
export function achievementTone(pct?: number | null): 'green' | 'amber' | 'red' | 'slate' {
  if (pct === null || pct === undefined) return 'slate'
  const t = currentSettings().thresholds ?? { on_track: 75, watch: 50 }
  return pct >= t.on_track ? 'green' : pct >= t.watch ? 'amber' : 'red'
}
const BAR = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', slate: 'bg-slate-300', brand: 'bg-brand-600', gold: 'bg-gold-400' }
export const TONE_TEXT = { green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-600', slate: 'text-slate-500' }

export function ProgressBar({ value, tone, className }: { value?: number | null; tone?: keyof typeof BAR; className?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-200', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all', BAR[tone ?? achievementTone(value)])} style={{ width: `${v}%` }} />
    </div>
  )
}

// ---------------------------------------------------------------- form fields
const INPUT = 'block w-full rounded-lg border bg-white px-3 text-sm text-ink placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500'

export function Field({ label, required, error, hint, children, className }: { label?: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
          {label}{required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
        </span>
      )}
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs font-medium text-red-600">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  )
}

export function Input({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx(INPUT, 'h-10', invalid ? 'border-red-400 bg-red-50/40' : 'border-slate-300', className)} {...rest} />
}

export function Textarea({ invalid, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea rows={3} className={cx(INPUT, 'py-2', invalid ? 'border-red-400 bg-red-50/40' : 'border-slate-300', className)} {...rest} />
}

export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select className={cx(INPUT, 'h-10 appearance-none pr-9', invalid ? 'border-red-400 bg-red-50/40' : 'border-slate-300', className)} {...rest}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cx('inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 shadow-card', className)} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition', value === o.value ? 'bg-brand-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100')}>
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className={cx('rounded-full px-1.5 text-[11px]', value === o.value ? 'bg-white/20' : 'bg-slate-200 text-slate-700')}>{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Monthly / Quarterly / Yearly switch with a period picker (used on dashboards and records). */
export function PeriodPicker({ value, onChange, years = 3 }: { value: Period; onChange: (p: Period) => void; years?: number }) {
  const thisYear = new Date().getFullYear()
  const yearList = Array.from({ length: years }, (_, i) => thisYear - i)
  const fy = currentSettings().fiscal_year_start || 1
  const quarterLabel = (q: number) => {
    const s = (fy + 3 * (q - 1) - 1) % 12
    return `Q${q} (${MONTH_NAMES[s]}–${MONTH_NAMES[(s + 2) % 12]})`
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs<PeriodMode> value={value.mode} onChange={(mode) => onChange(currentPeriod(mode))}
        options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }]} />
      {value.mode === 'monthly' && (
        <div className="w-28"><Select aria-label="Month" value={value.period} onChange={(e) => onChange({ ...value, period: +e.target.value })}>
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select></div>
      )}
      {value.mode === 'quarterly' && (
        <div className="w-40"><Select aria-label="Quarter" value={value.period} onChange={(e) => onChange({ ...value, period: +e.target.value })}>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{quarterLabel(q)}</option>)}
        </Select></div>
      )}
      <div className="w-24"><Select aria-label="Year" value={value.year} onChange={(e) => onChange({ ...value, year: +e.target.value })}>
        {yearList.map((y) => <option key={y} value={y}>{y}</option>)}
      </Select></div>
    </div>
  )
}

// ---------------------------------------------------------------- modal and dialogs
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" className={cx('animate-in flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl', widths[size])}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-brand-950">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  tone?: 'primary' | 'danger' | 'success' | 'warn'
  /** ask for a reason; the promise resolves with the text */
  reason?: boolean | string
  reasonRequired?: boolean
}
type Toast = { id: number; tone: 'success' | 'error' | 'warn'; text: string }

interface UiState {
  toast: { success: (t: string) => void; error: (t: string) => void; warn: (t: string) => void }
  /** Resolves true/false, or the reason text (string) when `reason` is set; false when cancelled. */
  confirm: (o: ConfirmOptions) => Promise<boolean | string>
}
const UiCtx = createContext<UiState>(null as any)
/** `const { toast, confirm } = useUi()` — toasts (BRD 10.5) and confirmation dialogs. */
export const useUi = () => useContext(UiCtx)

/** Message text of any thrown error, for toasts and inline notes. */
export const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.')

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean | string) => void }) | null>(null)
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState('')
  const seq = useRef(0)

  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, tone, text }])
    // success disappears after 4 seconds; warnings and errors stay until dismissed
    if (tone === 'success') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
    else setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 12000)
  }, [])

  const value = useRef<UiState>({
    toast: { success: (t) => push('success', t), error: (t) => push('error', t), warn: (t) => push('warn', t) },
    confirm: (o) => new Promise((resolve) => { setReason(''); setReasonErr(''); setDialog({ ...o, resolve }) }),
  }).current

  const close = (v: boolean | string) => { dialog?.resolve(v); setDialog(null) }
  const ok = () => {
    if (!dialog) return
    if (dialog.reason) {
      if ((dialog.reasonRequired ?? true) && !reason.trim()) { setReasonErr('Please enter a reason.'); return }
      close(reason.trim() || true)
    } else close(true)
  }
  const tones = { success: 'border-emerald-200 bg-emerald-50 text-emerald-900', error: 'border-red-200 bg-red-50 text-red-900', warn: 'border-orange-200 bg-orange-50 text-orange-900' }
  const icons = { success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, error: <XCircle className="h-5 w-5 text-red-600" />, warn: <AlertTriangle className="h-5 w-5 text-orange-500" /> }

  return (
    <UiCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(92vw,380px)] flex-col gap-2 no-print" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('animate-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-pop', tones[t.tone])}>
            <span className="mt-px shrink-0">{icons[t.tone]}</span>
            <span className="flex-1">{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <Modal open={!!dialog} onClose={() => close(false)} title={dialog?.title ?? ''} size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
          <Button variant={dialog?.tone === 'danger' ? 'danger' : dialog?.tone === 'success' ? 'success' : dialog?.tone === 'warn' ? 'gold' : 'primary'} onClick={ok}>{dialog?.confirmLabel ?? 'Confirm'}</Button>
        </>}>
        {dialog?.message && <div className="text-sm text-slate-700">{dialog.message}</div>}
        {dialog?.reason && (
          <Field label={typeof dialog.reason === 'string' ? dialog.reason : 'Reason'} required={dialog.reasonRequired ?? true} error={reasonErr} className="mt-3">
            <Textarea autoFocus value={reason} invalid={!!reasonErr} onChange={(e) => { setReason(e.target.value); setReasonErr('') }} />
          </Field>
        )}
      </Modal>
    </UiCtx.Provider>
  )
}

// ---------------------------------------------------------------- data loading
/** Load data with loading/error state. `reload()` refetches; pass deps to refetch when filters change. */
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const fnRef = useRef(fn)
  fnRef.current = fn
  const run = useCallback((silent = false) => {
    let live = true
    if (!silent) setLoading(true)
    fnRef.current().then((d) => { if (live) { setData(d); setError('') } })
      .catch((e) => { if (live) setError(errText(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => run(), [run])
  return { data, loading, error, reload: () => { run(true) }, setData }
}

/** Definition list: only rows that have a value are shown (FR-GEN-04). */
export function Facts({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 | 4 }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-2 lg:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' }
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', grid[cols])}>
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-brand-950">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
