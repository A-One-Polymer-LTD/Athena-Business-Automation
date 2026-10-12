// Organisation settings (FR-SA-07): localisation, number prefixes, optional stages, stage time limits, ranking weights.
import { ArrowRight, Save, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, ErrorNote, Field, Input, Notice, PageHeader, Pill, Select, Spinner, StatusBadge, cx, errText, useLoad, useUi } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { num } from '../../lib/format'

interface SettingsData {
  organisation: string
  currency: string
  currency_symbol: string
  number_format: string
  date_format: string
  timezone: string
  language: string
  fiscal_year_start: number | string
  measurement_unit: string
  prefixes: Record<string, string>
  optional_stages: Record<string, boolean>
  stage_limit_days: Record<string, number | string>
  weights: Record<string, number | string>
  thresholds: Record<string, number | string>
}
interface Meta {
  production_stages: string[]
  sites: { id: number; code: string; name: string; type?: string; active: boolean; apm?: string; open_items: number }[]
}

const YEAR = new Date().getFullYear()
// key, label, example of the number that follows the prefix
const PREFIXES: [string, string, string][] = [
  ['order', 'Order', `-${YEAR}-000123`],
  ['customer', 'Customer', '-000123'],
  ['store_req', 'Store requisition', `-${YEAR}-00045`],
  ['wood_req', 'Wood requisition', `-${YEAR}-00045`],
  ['qc', 'QC report', `-${YEAR}-000123`],
  ['report', 'Production report', `-${YEAR}-000123-R1`],
  ['cost', 'Cost sheet', `-${YEAR}-000123`],
  ['sales_entry', 'Sales entry', `-${YEAR}-000123`],
  ['lead', 'Lead', `-${YEAR}-00412`],
]
const OPTIONAL: [string, string, string][] = [
  ['machine_room_2', 'Second Machine Room pass', 'Items can return to the Machine Room after the Production Site, before Form/Design Ready.'],
  ['upholstery', 'Upholstery', 'Items that need upholstery go through Upholstery and Upholstery QC after Lacquer QC.'],
]
const WEIGHTS: [string, string][] = [['sales', 'Sales'], ['collection', 'Collection'], ['delivery', 'Delivery'], ['visits', 'Client visits']]
const DATE_FORMATS: [string, string][] = [['DD-MMM-YYYY', 'DD-MMM-YYYY (28-Sep-2026)'], ['DD/MM/YYYY', 'DD/MM/YYYY (28/09/2026)'], ['YYYY-MM-DD', 'YYYY-MM-DD (2026-09-28)'], ['MM/DD/YYYY', 'MM/DD/YYYY (09/28/2026)']]
const TIMEZONES = ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC']
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const TOP_KEYS: (keyof SettingsData)[] = ['organisation', 'currency', 'currency_symbol', 'number_format', 'date_format', 'timezone', 'language', 'fiscal_year_start',
  'measurement_unit', 'prefixes', 'optional_stages', 'stage_limit_days', 'weights', 'thresholds']

const n = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v))
const validZone = (tz: string) => { try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true } catch { return false } }

/** Values as they are sent to the server: trimmed text and real numbers. */
function normalise(s: SettingsData): SettingsData {
  const nums = (o: Record<string, number | string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]))
  return {
    ...s,
    organisation: s.organisation.trim(), currency: s.currency.trim().toUpperCase(), currency_symbol: s.currency_symbol.trim(),
    timezone: s.timezone.trim(), language: s.language.trim(), measurement_unit: s.measurement_unit.trim(),
    fiscal_year_start: Number(s.fiscal_year_start),
    prefixes: Object.fromEntries(Object.entries(s.prefixes).map(([k, v]) => [k, String(v).trim().toUpperCase()])),
    stage_limit_days: nums(s.stage_limit_days), weights: nums(s.weights), thresholds: nums(s.thresholds),
  }
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-700' : 'bg-slate-300')}>
      <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}

export default function Settings() {
  const { toast } = useUi()
  const { reloadSettings } = useAuth()
  const loaded = useLoad<SettingsData>(() => api.get('/settings'))
  const meta = useLoad<Meta>(() => api.get('/meta'))
  const [saved, setSaved] = useState<SettingsData | null>(null)
  const [form, setForm] = useState<SettingsData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (loaded.data && !saved) { setSaved(loaded.data); setForm(structuredClone(loaded.data)) }
  }, [loaded.data, saved])

  const set = <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const setIn = (k: 'prefixes' | 'optional_stages' | 'stage_limit_days' | 'weights' | 'thresholds', sub: string, v: string | boolean) =>
    setForm((f) => (f ? { ...f, [k]: { ...f[k], [sub]: v } } : f))

  const stageKeys = useMemo(() => {
    if (!form) return []
    const have = Object.keys(form.stage_limit_days).filter((k) => k !== 'default')
    const order = meta.data?.production_stages ?? []
    return [...order, ...have.filter((s) => !order.includes(s))]
  }, [form, meta.data])

  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!form) return e
    if (form.organisation.trim().length < 2) e.organisation = 'Please enter the organisation name.'
    if (!form.currency.trim()) e.currency = 'Please enter the currency code.'
    if (!form.currency_symbol.trim()) e.currency_symbol = 'Please enter the currency symbol.'
    if (!form.timezone.trim() || !validZone(form.timezone.trim())) e.timezone = 'Please enter a valid time zone, e.g. Asia/Dhaka.'
    PREFIXES.forEach(([k, label]) => {
      const v = String(form.prefixes[k] ?? '').trim()
      if (!v || v.length > 6 || !/^[A-Za-z0-9-]+$/.test(v) || !/[A-Za-z0-9]/.test(v)) e[`prefix.${k}`] = `${label}: 1 to 6 letters or digits.`
    })
    ;['default', ...stageKeys].forEach((k) => {
      const v = n(form.stage_limit_days[k])
      if (k !== 'default' && form.stage_limit_days[k] === undefined) return
      if (!Number.isInteger(v) || v < 1) e[`limit.${k}`] = 'Whole days, 1 or more.'
    })
    const ws = WEIGHTS.map(([k]) => n(form.weights[k]))
    if (ws.some((v) => Number.isNaN(v) || v < 0)) e.weights = 'Each weight must be a number, 0 or more.'
    else if (Math.round(ws.reduce((a, b) => a + b, 0) * 100) / 100 !== 100) e.weights = 'Ranking weights must total 100%.'
    const on = n(form.thresholds.on_track), watch = n(form.thresholds.watch)
    if (Number.isNaN(on) || Number.isNaN(watch)) e.thresholds = 'Please enter both thresholds.'
    else if (!(watch > 0 && watch < on && on <= 100)) e.thresholds = 'The Watch threshold must be above 0 and below the On Track threshold, which can be at most 100.'
    return e
  }, [form, stageKeys])

  const changed = useMemo(() => {
    if (!form || !saved) return [] as (keyof SettingsData)[]
    let a: SettingsData, b: SettingsData
    try { a = normalise(form); b = normalise(saved) } catch { return TOP_KEYS }
    return TOP_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
  }, [form, saved])

  const weightTotal = form ? WEIGHTS.reduce((a, [k]) => a + (n(form.weights[k]) || 0), 0) : 0
  const errorList = Object.values(errors)

  const save = async () => {
    if (!form) return
    setTried(true); setError('')
    if (errorList.length) { setError('Please correct the highlighted fields before saving.'); return }
    const clean = normalise(form)
    const body = Object.fromEntries(changed.map((k) => [k, clean[k]]))
    setSaving(true)
    try {
      const res = await api.put('/settings', body)
      const next: SettingsData = res.settings ?? clean
      setSaved(next); setForm(structuredClone(next)); setTried(false)
      toast.success(res.message ?? 'Settings saved.')
      try { await reloadSettings() } catch { /* formats refresh at the next sign-in */ }
    } catch (ex) { setError(errText(ex)) } finally { setSaving(false) }
  }
  const discard = () => { if (saved) { setForm(structuredClone(saved)); setError(''); setTried(false) } }

  const show = (k: string) => (tried ? errors[k] : undefined)
  const sites = meta.data?.sites ?? []
  const activeSites = sites.filter((s) => s.active)

  return (
    <div className="pb-20">
      <PageHeader title="Organisation Settings" subtitle="Localisation, numbering and workflow options that apply across the whole system."
        actions={<>
          {changed.length > 0 && <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={discard} disabled={saving}>Discard changes</Button>}
          <Button icon={<Save className="h-4 w-4" />} loading={saving} disabled={!form || changed.length === 0} onClick={save}>Save settings</Button>
        </>} />

      <ErrorNote error={loaded.error} className="mb-4" />
      {!form ? (loaded.error ? null : <Spinner label="Loading settings…" />) : (
        <div className="space-y-4">
          <ErrorNote error={error} />

          <Card title="Organisation" subtitle="Name, currency, number and date formats">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Organisation name" required error={show('organisation')} className="sm:col-span-2 lg:col-span-1">
                <Input value={form.organisation} maxLength={150} invalid={!!show('organisation')} onChange={(e) => set('organisation', e.target.value)} />
              </Field>
              <Field label="Currency code" required error={show('currency')} hint="For example BDT.">
                <Input value={form.currency} maxLength={5} invalid={!!show('currency')} onChange={(e) => set('currency', e.target.value)} />
              </Field>
              <Field label="Currency symbol" required error={show('currency_symbol')} hint="Shown before every amount.">
                <Input value={form.currency_symbol} maxLength={5} invalid={!!show('currency_symbol')} onChange={(e) => set('currency_symbol', e.target.value)} />
              </Field>
              <Field label="Number format">
                <Select value={form.number_format} onChange={(e) => set('number_format', e.target.value)}>
                  <option value="lakh">Lakh / crore (18,50,000)</option>
                  <option value="international">International (1,850,000)</option>
                </Select>
              </Field>
              <Field label="Date format">
                <Select value={form.date_format} onChange={(e) => set('date_format', e.target.value)}>
                  {DATE_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  {!DATE_FORMATS.some(([v]) => v === form.date_format) && <option value={form.date_format}>{form.date_format}</option>}
                </Select>
              </Field>
              <Field label="Time zone" required error={show('timezone')} hint="IANA name, e.g. Asia/Dhaka.">
                <Input value={form.timezone} list="tz-suggestions" maxLength={60} invalid={!!show('timezone')} onChange={(e) => set('timezone', e.target.value)} />
                <datalist id="tz-suggestions">{TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist>
              </Field>
              <Field label="Language">
                <Input value={form.language} maxLength={40} onChange={(e) => set('language', e.target.value)} />
              </Field>
              <Field label="Measurement unit" hint="Used for product dimensions.">
                <Select value={form.measurement_unit} onChange={(e) => set('measurement_unit', e.target.value)}>
                  {[['in', 'Inches (in)'], ['cm', 'Centimetres (cm)'], ['mm', 'Millimetres (mm)'], ['ft', 'Feet (ft)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  {!['in', 'cm', 'mm', 'ft'].includes(form.measurement_unit) && form.measurement_unit && <option value={form.measurement_unit}>{form.measurement_unit}</option>}
                </Select>
              </Field>
              <Field label="Fiscal year starts in" hint="Quarters and yearly periods follow this month.">
                <Select value={form.fiscal_year_start} onChange={(e) => set('fiscal_year_start', +e.target.value)}>
                  {FULL_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="Number prefixes" subtitle="1 to 6 letters or digits each. New numbers use the new prefix; existing numbers do not change.">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {PREFIXES.map(([k, label, tail]) => {
                const v = String(form.prefixes[k] ?? '')
                const bad = !!errors[`prefix.${k}`]
                return (
                  <Field key={k} label={label} error={bad && (tried || v !== '') ? '1 to 6 letters or digits.' : undefined}
                    hint={<>Example: <span className="tabular font-semibold text-brand-800">{(v.trim().toUpperCase() || '…') + tail}</span></>}>
                    <Input value={v} maxLength={6} invalid={bad && (tried || v !== '')} className="uppercase" onChange={(e) => setIn('prefixes', k, e.target.value)} />
                  </Field>
                )
              })}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="min-w-0" title="Optional stages" subtitle="Production stages that can be switched on or off">
              <ul className="divide-y divide-slate-100">
                {OPTIONAL.map(([k, label, hint]) => (
                  <li key={k} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-brand-950">{label}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{hint}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">{form.optional_stages[k] ? 'On' : 'Off'}</span>
                      <Toggle label={label} checked={!!form.optional_stages[k]} onChange={(v) => setIn('optional_stages', k, v)} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="min-w-0" title="Sites" subtitle="Read-only summary"
              actions={<Link to="/admin/masters" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-800 hover:underline">Manage in Master Data <ArrowRight className="h-3.5 w-3.5" /></Link>}>
              {meta.loading && !meta.data ? <Spinner /> : meta.error ? <ErrorNote error={meta.error} /> : sites.length === 0 ? (
                <p className="text-sm text-slate-500">No production sites have been set up yet.</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Pill tone="brand">{num(activeSites.length)} active</Pill>
                    <Pill>{num(activeSites.filter((s) => s.type !== 'Contract').length)} in-house</Pill>
                    <Pill tone="gold">{num(activeSites.filter((s) => s.type === 'Contract').length)} contract</Pill>
                    {sites.length > activeSites.length && <Pill>{num(sites.length - activeSites.length)} inactive</Pill>}
                  </div>
                  <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-sm">
                    {sites.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="font-semibold text-brand-900">{s.code}</span> <span className="text-slate-600">{s.name}</span>
                          <span className="block truncate text-xs text-slate-500">{[s.type, s.apm ? `APM: ${s.apm}` : 'No APM mapped', `${num(s.open_items)} open`].filter(Boolean).join(' · ')}</span>
                        </span>
                        <StatusBadge status={s.active ? 'Active' : 'Inactive'} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <Card title="Stage time limits" subtitle="Days an item may stay in a stage before it is flagged Delayed. An item is also Delayed once its due date has passed.">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 xl:grid-cols-4">
              {['default', ...stageKeys].map((k) => (
                <Field key={k} label={k === 'default' ? 'Default (any other stage)' : k} error={show(`limit.${k}`) ?? (errors[`limit.${k}`] && form.stage_limit_days[k] !== '' ? errors[`limit.${k}`] : undefined)}>
                  <div className="relative">
                    <Input type="number" min={1} step={1} inputMode="numeric" className="pr-12 tabular" value={form.stage_limit_days[k] ?? ''}
                      placeholder={k === 'default' ? undefined : String(form.stage_limit_days.default ?? '')}
                      invalid={!!errors[`limit.${k}`] && (tried || form.stage_limit_days[k] !== '')} onChange={(e) => setIn('stage_limit_days', k, e.target.value)} />
                    <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-500">days</span>
                  </div>
                </Field>
              ))}
            </div>
          </Card>

          <Card title="Sales ranking" subtitle="Weights of the ranking score and the achievement thresholds behind On Track, Watch and Critical">
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-bold uppercase tracking-wider text-brand-900">Ranking weights</p>
                  <Pill tone={errors.weights ? 'red' : 'green'}>Total {num(weightTotal, Number.isInteger(weightTotal) ? 0 : 2)}%</Pill>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {WEIGHTS.map(([k, label]) => (
                    <Field key={k} label={label}>
                      <div className="relative">
                        <Input type="number" min={0} max={100} step="any" inputMode="decimal" className="pr-8 tabular" value={form.weights[k] ?? ''} invalid={!!errors.weights} onChange={(e) => setIn('weights', k, e.target.value)} />
                        <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-500">%</span>
                      </div>
                    </Field>
                  ))}
                </div>
                {errors.weights ? <p role="alert" className="mt-2 text-xs font-medium text-red-600">{errors.weights} The current total is {num(weightTotal, Number.isInteger(weightTotal) ? 0 : 2)}%.</p>
                  : <p className="mt-2 text-xs text-slate-500">The four weights must total exactly 100%.</p>}
              </div>
              <div>
                <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-brand-900">Status thresholds</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="On Track ≥">
                    <div className="relative">
                      <Input type="number" min={1} max={100} step="any" inputMode="decimal" className="pr-8 tabular" value={form.thresholds.on_track ?? ''} invalid={!!errors.thresholds} onChange={(e) => setIn('thresholds', 'on_track', e.target.value)} />
                      <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-500">%</span>
                    </div>
                  </Field>
                  <Field label="Watch ≥">
                    <div className="relative">
                      <Input type="number" min={1} max={100} step="any" inputMode="decimal" className="pr-8 tabular" value={form.thresholds.watch ?? ''} invalid={!!errors.thresholds} onChange={(e) => setIn('thresholds', 'watch', e.target.value)} />
                      <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-500">%</span>
                    </div>
                  </Field>
                </div>
                {errors.thresholds ? <p role="alert" className="mt-2 text-xs font-medium text-red-600">{errors.thresholds}</p> : (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
                    <span className="flex items-center gap-1.5"><StatusBadge status="On Track" /> {form.thresholds.on_track}% and above</span>
                    <span className="flex items-center gap-1.5"><StatusBadge status="Watch" /> {form.thresholds.watch}% to below {form.thresholds.on_track}%</span>
                    <span className="flex items-center gap-1.5"><StatusBadge status="Critical" /> below {form.thresholds.watch}%</span>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {changed.length > 0 && (
            <div className="sticky bottom-3 z-20">
              <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-3 shadow-pop">
                <span className="font-medium">You have unsaved changes{errorList.length > 0 ? ` · ${errorList.length} field${errorList.length === 1 ? '' : 's'} need${errorList.length === 1 ? 's' : ''} correction` : ''}.</span>
                <span className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={discard} disabled={saving}>Discard</Button>
                  <Button size="sm" icon={<Save className="h-4 w-4" />} loading={saving} onClick={save}>Save settings</Button>
                </span>
              </Notice>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
