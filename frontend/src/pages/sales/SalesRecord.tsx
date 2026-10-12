// S5 Sales Record: a Sales Admin's own daily sales entries, with period totals against own targets.
import { Lock, Pencil, RotateCcw, Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, Card, ErrorNote, Field, Input, Notice, PageHeader, PeriodPicker, Pill, ProgressBar, Spinner, StatusBadge,
  Textarea, TONE_TEXT, achievementTone, cx, errText, useLoad, useUi,
} from '../../components/ui'
import { api, qs } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { currentPeriod, fmtDate, money, num, periodLabel, periodRange, todayISO, type Period } from '../../lib/format'

export interface Metric { actual?: number; target?: number; pct?: number; status?: string; no_target?: boolean }
export interface MySummary { label?: string; sales?: Metric; collection?: Metric; delivery?: Metric; visits?: Metric }

const MEASURES: { key: 'sales' | 'collection' | 'delivery' | 'visits'; label: string; isMoney: boolean }[] = [
  { key: 'sales', label: 'Sales', isMoney: true },
  { key: 'collection', label: 'Collection', isMoney: true },
  { key: 'delivery', label: 'Delivery', isMoney: true },
  { key: 'visits', label: 'Client Visits', isMoney: false },
]

/** Own totals against own targets for a period (never other Sales Admins, ranking or scores). */
export function MyTargets({ summary }: { summary: MySummary | null }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {MEASURES.map((m) => {
        const d: Metric = summary?.[m.key] ?? {}
        const fmt = (v?: number) => (m.isMoney ? money(v ?? 0) : num(v ?? 0))
        const hasTarget = !d.no_target && !!d.target
        return (
          <div key={m.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{m.label}</p>
              {hasTarget
                ? <span className={cx('text-sm font-bold tabular', TONE_TEXT[achievementTone(d.pct)])}>{Math.round(d.pct ?? 0)}%</span>
                : <StatusBadge status="No target" />}
            </div>
            <p className="mt-1.5 truncate font-display text-xl font-bold tabular text-brand-950">{fmt(d.actual)}</p>
            <p className="mt-0.5 text-xs text-slate-500">{hasTarget ? <>Target {fmt(d.target)}</> : 'No target set for this period'}</p>
            <ProgressBar className="mt-3" value={hasTarget ? d.pct : 0} tone={hasTarget ? undefined : 'slate'} />
          </div>
        )
      })}
    </div>
  )
}

interface Entry {
  id: number; entry_no: string; entry_date: string; sales: number; collection: number; delivery: number; visits: number
  remarks?: string; locked?: boolean
}
interface FormState { id: number | null; entry_no: string; entry_date: string; sales: string; collection: string; delivery: string; visits: string; remarks: string }
type FieldKey = 'entry_date' | 'sales' | 'collection' | 'delivery' | 'visits' | 'remarks'

const blank = (): FormState => ({ id: null, entry_no: '', entry_date: todayISO(), sales: '', collection: '', delivery: '', visits: '', remarks: '' })
const fromEntry = (e: Entry): FormState => ({
  id: e.id, entry_no: e.entry_no, entry_date: (e.entry_date || '').slice(0, 10), sales: e.sales ? String(e.sales) : '',
  collection: e.collection ? String(e.collection) : '', delivery: e.delivery ? String(e.delivery) : '',
  visits: e.visits ? String(e.visits) : '', remarks: e.remarks ?? '',
})

const LABELS: Record<FieldKey, string> = {
  entry_date: 'Entry Date', sales: 'Sales Amount', collection: 'Collection Amount', delivery: 'Delivery Amount', visits: 'Client Visits', remarks: 'Remarks',
}

function check(f: FormState, key: FieldKey): string {
  const v = f[key].trim()
  if (key === 'entry_date') {
    if (!v) return 'Please enter Entry Date.'
    if (v > todayISO()) return 'Entry Date cannot be in the future.'
    return ''
  }
  if (key === 'remarks') return v.length > 500 ? 'Remarks can be up to 500 characters.' : ''
  if (!v) return ''
  const n = Number(v)
  if (Number.isNaN(n)) return `${LABELS[key]} must be a number.`
  if (n < 0) return `${LABELS[key]} must be 0 or more.`
  if (key === 'visits' && !Number.isInteger(n)) return 'Client Visits must be a whole number.'
  return ''
}

export default function SalesRecord() {
  const { user } = useAuth()
  const { toast } = useUi()
  const [period, setPeriod] = useState<Period>(currentPeriod())
  const [form, setForm] = useState<FormState>(blank)
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const range = periodRange(period)
  const list = useLoad<Entry[]>(() => api.get(`/sales/entries${qs({ date_from: range.from, date_to: range.to })}`), [range.from, range.to])
  const summary = useLoad<MySummary>(() => api.get(`/sales/summary${qs({ mode: period.mode, year: period.year, period: period.period })}`), [period.mode, period.year, period.period])

  const rows = list.data ?? []
  const totals = useMemo(() => rows.reduce((t, r) => ({
    sales: t.sales + (r.sales || 0), collection: t.collection + (r.collection || 0), delivery: t.delivery + (r.delivery || 0), visits: t.visits + (r.visits || 0),
  }), { sales: 0, collection: 0, delivery: 0, visits: 0 }), [rows])

  const set = (key: FieldKey, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }))
    setFormError('')
  }
  const blur = (key: FieldKey) => setErrors((e) => ({ ...e, [key]: check(form, key) }))
  const reset = () => { setForm(blank()); setErrors({}); setFormError(''); setNotice('') }
  const edit = (e: Entry) => {
    setForm(fromEntry(e)); setErrors({}); setFormError(''); setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    const errs: Partial<Record<FieldKey, string>> = {}
    ;(Object.keys(LABELS) as FieldKey[]).forEach((k) => { const m = check(form, k); if (m) errs[k] = m })
    setErrors(errs)
    if (Object.keys(errs).length) return
    const nums = { sales: Number(form.sales || 0), collection: Number(form.collection || 0), delivery: Number(form.delivery || 0), visits: Number(form.visits || 0) }
    // a new entry for a date that already has one is opened by the server, so the empty check applies only when editing
    if (form.id && !nums.sales && !nums.collection && !nums.delivery && !nums.visits) {
      setFormError('At least one of Sales, Collection, Delivery or Client Visits must be greater than 0.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.post('/sales/entries', { ...(form.id ? { id: form.id } : {}), entry_date: form.entry_date, ...nums, remarks: form.remarks.trim() })
      if (res.existing) {
        setForm(fromEntry(res.entry))
        setErrors({})
        setNotice(res.message)
      } else {
        toast.success(res.message)
        setForm(blank()); setErrors({}); setNotice('')
        list.reload()
        summary.reload()
      }
    } catch (e) {
      setFormError(errText(e))
    } finally {
      setSaving(false)
    }
  }

  const columns: Column<Entry>[] = [
    { key: 'entry_no', header: 'Entry No.', render: (r) => <span className="font-semibold text-brand-900">{r.entry_no}</span> },
    { key: 'entry_date', header: 'Date', value: (r) => (r.entry_date || '').slice(0, 10), render: (r) => <span className="whitespace-nowrap">{fmtDate(r.entry_date)}</span> },
    { key: 'sales', header: 'Sales', align: 'right', always: true, render: (r) => money(r.sales) },
    { key: 'collection', header: 'Collection', align: 'right', always: true, render: (r) => money(r.collection) },
    { key: 'delivery', header: 'Delivery', align: 'right', always: true, render: (r) => money(r.delivery) },
    { key: 'visits', header: 'Client Visits', align: 'right', always: true, render: (r) => num(r.visits) },
    { key: 'remarks', header: 'Remarks', always: true, render: (r) => (r.remarks ? <span className="block max-w-xs whitespace-normal text-slate-600">{r.remarks}</span> : null) },
    { key: 'locked', header: 'Period', always: true, value: (r) => (r.locked ? 'Locked' : ''), render: (r) => (r.locked ? <StatusBadge status="Locked" /> : null) },
    {
      key: 'actions', header: '', noExport: true, align: 'right',
      render: (r) => (
        <Button variant="ghost" size="sm" disabled={!!r.locked} title={r.locked ? 'This period is locked' : undefined}
          icon={r.locked ? <Lock className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />} onClick={() => edit(r)}>Edit</Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Sales Record" subtitle="Your daily sales, collection, delivery and client visits." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start" title={form.id ? `Edit entry ${form.entry_no}` : 'Add daily entry'}
          subtitle={form.id ? 'Change the values and save.' : 'One entry per date.'}
          actions={form.id ? <Pill tone="gold">Editing</Pill> : undefined}>
          <div className="space-y-4">
            {notice && <Notice tone="warn">{notice}</Notice>}
            <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 px-3.5 py-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Sales Admin</p>
                <p className="truncate text-sm font-semibold text-brand-950">{user?.name}</p>
              </div>
              {user?.branch && (
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">Branch</p>
                  <p className="truncate text-sm font-semibold text-brand-950">{user.branch}</p>
                </div>
              )}
            </div>
            <Field label="Entry Date" required error={errors.entry_date}>
              <Input type="date" max={todayISO()} value={form.entry_date} invalid={!!errors.entry_date}
                onChange={(e) => set('entry_date', e.target.value)} onBlur={() => blur('entry_date')} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
              {(['sales', 'collection', 'delivery'] as const).map((k) => (
                <Field key={k} label={LABELS[k]} error={errors[k]}>
                  <Input type="number" inputMode="decimal" min={0} step="any" placeholder="0" value={form[k]} invalid={!!errors[k]}
                    onChange={(e) => set(k, e.target.value)} onBlur={() => blur(k)} />
                </Field>
              ))}
              <Field label="Client Visits" error={errors.visits} hint="Whole number">
                <Input type="number" inputMode="numeric" min={0} step={1} placeholder="0" value={form.visits} invalid={!!errors.visits}
                  onChange={(e) => set('visits', e.target.value)} onBlur={() => blur('visits')} />
              </Field>
            </div>
            <Field label="Remarks" error={errors.remarks} hint={`${form.remarks.length} / 500`}>
              <Textarea value={form.remarks} maxLength={500} invalid={!!errors.remarks}
                onChange={(e) => set('remarks', e.target.value)} onBlur={() => blur('remarks')} />
            </Field>
            <ErrorNote error={formError} />
            <div className="flex flex-wrap gap-2">
              <Button icon={<Save className="h-4 w-4" />} loading={saving} onClick={save}>{form.id ? 'Update entry' : 'Save entry'}</Button>
              {(form.id || notice) && <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} disabled={saving} onClick={reset}>New entry</Button>}
            </div>
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="border-l-4 border-gold-400 pl-3 text-[13px] font-bold uppercase tracking-wider text-brand-900">
              My totals and targets, {periodLabel(period)}
            </h2>
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
          {summary.error ? <ErrorNote error={summary.error} /> : summary.loading && !summary.data ? <Spinner /> : <MyTargets summary={summary.data} />}

          {list.error ? <ErrorNote error={list.error} /> : list.loading && !list.data ? <Spinner /> : (
            <DataTable<Entry> rows={rows} columns={columns} rowKey={(r) => r.id} exportName={`Sales Record ${periodLabel(period)}`}
              searchPlaceholder="Search entries…" initialSort={{ key: 'entry_date', dir: 'desc' }}
              emptyTitle="No sales entries in this period" emptyHint="Add a daily entry with the form to see it here."
              footer={(
                <tr>
                  <td className="px-4 py-3 text-brand-950" colSpan={2}>Period total ({rows.length} {rows.length === 1 ? 'entry' : 'entries'})</td>
                  <td className="px-4 py-3 text-right tabular text-brand-950">{money(totals.sales)}</td>
                  <td className="px-4 py-3 text-right tabular text-brand-950">{money(totals.collection)}</td>
                  <td className="px-4 py-3 text-right tabular text-brand-950">{money(totals.delivery)}</td>
                  <td className="px-4 py-3 text-right tabular text-brand-950">{num(totals.visits)}</td>
                  <td colSpan={3} />
                </tr>
              )} />
          )}
        </div>
      </div>
    </div>
  )
}
