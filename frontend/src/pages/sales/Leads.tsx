// S6 Leads: a Sales Admin's own leads, from first contact to Won or Lost.
import { Plus, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, ErrorNote, Field, Input, Modal, PageHeader, PeriodPicker, Pill, Select, Spinner, StatusBadge, Tabs, Textarea,
  errText, useLoad, useUi,
} from '../../components/ui'
import { api, ApiError, qs } from '../../lib/api'
import { compactMoney, currentPeriod, fmtDate, money, num, periodLabel, periodRange, todayISO, type Period } from '../../lib/format'

interface Lead {
  id: number; lead_no: string; lead_date: string; customer_name: string; customer_phone?: string; expected_value?: number
  stage: string; status: string; lost_reason?: string; next_followup?: string; remarks?: string; closed_on?: string
}
interface FormState {
  id: number | null; lead_no: string; lead_date: string; customer_name: string; customer_phone: string; expected_value: string
  stage: string; lost_reason: string; next_followup: string; remarks: string
}
type FieldKey = 'lead_date' | 'customer_name' | 'customer_phone' | 'expected_value' | 'stage' | 'lost_reason' | 'next_followup' | 'remarks'
type StatusTab = 'all' | 'Open' | 'Closed Won' | 'Closed Lost'

const DEFAULT_STAGES = ['New', 'Contacted', 'Visit / Measurement', 'Quotation Sent', 'Negotiation', 'Won', 'Lost']
const statusOf = (stage: string) => (stage === 'Won' ? 'Closed Won' : stage === 'Lost' ? 'Closed Lost' : 'Open')
const day = (iso?: string) => (iso || '').slice(0, 10)

const blank = (): FormState => ({ id: null, lead_no: '', lead_date: todayISO(), customer_name: '', customer_phone: '', expected_value: '', stage: 'New', lost_reason: '', next_followup: '', remarks: '' })
const fromLead = (l: Lead): FormState => ({
  id: l.id, lead_no: l.lead_no, lead_date: day(l.lead_date), customer_name: l.customer_name ?? '', customer_phone: l.customer_phone ?? '',
  expected_value: l.expected_value ? String(l.expected_value) : '', stage: l.stage, lost_reason: l.lost_reason ?? '',
  next_followup: day(l.next_followup), remarks: l.remarks ?? '',
})

function check(f: FormState, key: FieldKey): string {
  const v = f[key].trim()
  switch (key) {
    case 'lead_date':
      if (!v) return 'Please enter Lead Date.'
      return v > todayISO() ? 'Lead Date cannot be in the future.' : ''
    case 'customer_name':
      if (!v) return 'Please enter Customer Name.'
      return v.length < 2 || v.length > 100 ? 'Customer Name must be 2 to 100 characters.' : ''
    case 'customer_phone': {
      if (!v) return ''
      const digits = v.replace(/[^\d]/g, '')
      return digits.length < 7 || digits.length > 15 ? 'Please enter a valid mobile number.' : ''
    }
    case 'expected_value': {
      if (!v) return ''
      const n = Number(v)
      return Number.isNaN(n) ? 'Expected Value must be a number.' : n < 0 ? 'Expected Value must be 0 or more.' : ''
    }
    case 'stage': return v ? '' : 'Please enter Stage.'
    case 'lost_reason': return f.stage === 'Lost' && !v ? 'Please enter the reason this lead was lost.' : ''
    case 'next_followup': return v && f.lead_date && v < f.lead_date ? 'Next Follow-up Date must be on or after the Lead Date.' : ''
    case 'remarks': return v.length > 500 ? 'Remarks can be up to 500 characters.' : ''
  }
}
const KEYS: FieldKey[] = ['lead_date', 'customer_name', 'customer_phone', 'expected_value', 'stage', 'lost_reason', 'next_followup', 'remarks']

function Chip({ label, value, tone = 'text-brand-950' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 truncate font-display text-xl font-bold tabular ${tone}`}>{value}</p>
    </div>
  )
}

export default function Leads() {
  const nav = useNavigate()
  const { toast, confirm } = useUi()
  const [period, setPeriod] = useState<Period>(currentPeriod())
  const [tab, setTab] = useState<StatusTab>('all')
  const [form, setForm] = useState<FormState | null>(null)
  const [saved, setSaved] = useState<Lead | null>(null) // the lead as stored, while the form is open
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const range = periodRange(period)
  const list = useLoad<Lead[]>(() => api.get(`/sales/leads${qs({ date_from: range.from, date_to: range.to })}`), [range.from, range.to])
  const meta = useLoad<any>(() => api.get('/meta'), [])
  const stages: string[] = meta.data?.lead_stages?.length ? meta.data.lead_stages : DEFAULT_STAGES

  const all = list.data ?? []
  const today = todayISO()
  const stats = useMemo(() => {
    const won = all.filter((l) => l.status === 'Closed Won').length
    const lost = all.filter((l) => l.status === 'Closed Lost').length
    const open = all.filter((l) => l.status === 'Open')
    return { total: all.length, won, lost, open: open.length, conversion: all.length ? Math.round((won / all.length) * 100) : null, pipeline: open.reduce((t, l) => t + (l.expected_value || 0), 0) }
  }, [all])
  const rows = tab === 'all' ? all : all.filter((l) => l.status === tab)

  const startOrder = (l: { id: number; customer_name: string; customer_phone?: string }) =>
    nav('/sales/orders/new', { state: { lead: { id: l.id, customer_name: l.customer_name, customer_phone: l.customer_phone ?? '' } } })

  const open = (l?: Lead) => { setForm(l ? fromLead(l) : blank()); setSaved(l ?? null); setErrors({}); setFormError('') }
  const close = () => { if (!saving) setForm(null) }
  const set = (key: FieldKey, value: string) => {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }))
    setFormError('')
  }
  const blur = (key: FieldKey) => { if (form) setErrors((e) => ({ ...e, [key]: check(form, key) })) }

  const save = async (confirmDuplicate = false) => {
    if (!form) return
    const errs: Partial<Record<FieldKey, string>> = {}
    KEYS.forEach((k) => { const m = check(form, k); if (m) errs[k] = m })
    setErrors(errs)
    if (Object.keys(errs).length) return
    const body = {
      lead_date: form.lead_date, customer_name: form.customer_name.trim(), customer_phone: form.customer_phone.trim(),
      expected_value: Number(form.expected_value || 0), stage: form.stage, lost_reason: form.stage === 'Lost' ? form.lost_reason.trim() : '',
      next_followup: form.next_followup || null, remarks: form.remarks.trim(), ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
    }
    setSaving(true)
    setFormError('')
    try {
      const res = form.id ? await api.put(`/sales/leads/${form.id}`, body) : await api.post('/sales/leads', body)
      toast.success(res.message)
      setForm(null)
      list.reload()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'duplicate') {
        // stays "saving" while the question is open, so the form cannot be closed underneath it
        const ok = await confirm({ title: 'Possible duplicate lead', message: e.message, confirmLabel: 'Save anyway', tone: 'warn' })
        if (ok) await save(true)
        return
      }
      setFormError(errText(e))
    } finally {
      setSaving(false)
    }
  }

  const columns: Column<Lead>[] = [
    { key: 'lead_no', header: 'Lead ID', render: (r) => <span className="font-semibold text-brand-900">{r.lead_no}</span> },
    { key: 'lead_date', header: 'Lead Date', value: (r) => day(r.lead_date), render: (r) => <span className="whitespace-nowrap">{fmtDate(r.lead_date)}</span> },
    { key: 'customer_name', header: 'Customer', render: (r) => <span className="font-medium">{r.customer_name}</span> },
    { key: 'customer_phone', header: 'Phone' },
    { key: 'expected_value', header: 'Expected Value', align: 'right', render: (r) => (r.expected_value ? money(r.expected_value) : null) },
    { key: 'stage', header: 'Stage', render: (r) => <Pill tone={r.stage === 'Won' ? 'green' : r.stage === 'Lost' ? 'slate' : 'brand'}>{r.stage}</Pill> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'next_followup', header: 'Next Follow-up', value: (r) => day(r.next_followup),
      render: (r) => {
        if (!r.next_followup) return null
        const overdue = r.status === 'Open' && day(r.next_followup) < today
        return (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className={overdue ? 'font-semibold text-red-600' : undefined}>{fmtDate(r.next_followup)}</span>
            {overdue && <Pill tone="red">Overdue</Pill>}
          </span>
        )
      },
    },
    {
      key: 'remarks', header: 'Remarks', value: (r) => [r.remarks, r.lost_reason ? `Lost: ${r.lost_reason}` : ''].filter(Boolean).join(' | '),
      render: (r) => (r.remarks || r.lost_reason ? (
        <span className="block max-w-xs whitespace-normal text-slate-600">
          {r.remarks}{r.remarks && r.lost_reason ? <br /> : null}
          {r.lost_reason && <span className="text-slate-500">Lost: {r.lost_reason}</span>}
        </span>
      ) : null),
    },
    {
      key: 'actions', header: '', noExport: true, align: 'right',
      render: (r) => (r.status === 'Closed Won' ? (
        <Button variant="ghost" size="sm" icon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); startOrder(r) }}>Start order</Button>
      ) : null),
    },
  ]

  const formStatus = form ? statusOf(form.stage) : 'Open'
  const canStartOrder = !!form?.id && saved?.status === 'Closed Won' && form.stage === 'Won'

  return (
    <div>
      <PageHeader title="Leads" subtitle={`Your leads dated in ${periodLabel(period)}`}
        actions={<>
          <PeriodPicker value={period} onChange={setPeriod} />
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => open()}>Add lead</Button>
        </>} />

      {list.error ? <ErrorNote error={list.error} /> : list.loading && !list.data ? <Spinner /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Chip label="Leads" value={num(stats.total)} />
            <Chip label="Won" value={num(stats.won)} tone="text-emerald-700" />
            <Chip label="Lost" value={num(stats.lost)} tone="text-slate-600" />
            <Chip label="Open" value={num(stats.open)} tone="text-blue-800" />
            <Chip label="Conversion" value={stats.conversion === null ? 'No leads' : `${stats.conversion}%`} />
            <Chip label="Open Pipeline Value" value={compactMoney(stats.pipeline)} tone="text-gold-700" />
          </div>
          <DataTable<Lead> rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => open(r)}
            exportName={`Leads ${periodLabel(period)}`} searchPlaceholder="Search leads…" initialSort={{ key: 'lead_date', dir: 'desc' }}
            emptyTitle={tab === 'all' ? 'No leads in this period' : `No ${tab.toLowerCase()} leads in this period`}
            emptyHint="Add a lead, or choose another period."
            filters={<Tabs<StatusTab> value={tab} onChange={setTab} className="!shadow-none"
              options={[{ value: 'all', label: 'All', count: stats.total }, { value: 'Open', label: 'Open', count: stats.open },
                { value: 'Closed Won', label: 'Closed Won', count: stats.won }, { value: 'Closed Lost', label: 'Closed Lost', count: stats.lost }]} />} />
        </>
      )}

      <Modal open={!!form} onClose={close} size="lg" title={form?.id ? `Update lead ${form.lead_no}` : 'Add lead'}
        footer={<>
          {canStartOrder && saved && (
            <Button variant="secondary" className="mr-auto" disabled={saving} icon={<ShoppingCart className="h-4 w-4" />} onClick={() => startOrder(saved)}>Start order</Button>
          )}
          <Button variant="secondary" disabled={saving} onClick={close}>Cancel</Button>
          <Button loading={saving} onClick={() => save()}>{form?.id ? 'Update lead' : 'Save lead'}</Button>
        </>}>
        {form && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Lead Date" required error={errors.lead_date}>
              <Input type="date" max={today} value={form.lead_date} invalid={!!errors.lead_date} onChange={(e) => set('lead_date', e.target.value)} onBlur={() => blur('lead_date')} />
            </Field>
            <Field label="Customer Name" required error={errors.customer_name}>
              <Input value={form.customer_name} maxLength={100} invalid={!!errors.customer_name} onChange={(e) => set('customer_name', e.target.value)} onBlur={() => blur('customer_name')} />
            </Field>
            <Field label="Customer Phone" error={errors.customer_phone}>
              <Input type="tel" inputMode="tel" value={form.customer_phone} maxLength={20} invalid={!!errors.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} onBlur={() => blur('customer_phone')} />
            </Field>
            <Field label="Expected Value" error={errors.expected_value}>
              <Input type="number" inputMode="decimal" min={0} step="any" placeholder="0" value={form.expected_value} invalid={!!errors.expected_value} onChange={(e) => set('expected_value', e.target.value)} onBlur={() => blur('expected_value')} />
            </Field>
            <Field label="Stage" required error={errors.stage}>
              <Select value={form.stage} invalid={!!errors.stage} onChange={(e) => set('stage', e.target.value)}>
                {(stages.includes(form.stage) ? stages : [form.stage, ...stages]).map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Status</span>
              <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
                <StatusBadge status={formStatus} />
                <span className="text-xs text-slate-500">Set automatically from the stage</span>
              </div>
            </div>
            {form.stage === 'Lost' && (
              <Field label="Lost Reason" required error={errors.lost_reason} className="sm:col-span-2">
                <Textarea rows={2} value={form.lost_reason} maxLength={500} invalid={!!errors.lost_reason} onChange={(e) => set('lost_reason', e.target.value)} onBlur={() => blur('lost_reason')} />
              </Field>
            )}
            <Field label="Next Follow-up Date" error={errors.next_followup}>
              <Input type="date" min={form.lead_date || undefined} value={form.next_followup} invalid={!!errors.next_followup} onChange={(e) => set('next_followup', e.target.value)} onBlur={() => blur('next_followup')} />
            </Field>
            <Field label="Remarks" error={errors.remarks} hint={`${form.remarks.length} / 500`} className="sm:col-span-2">
              <Textarea value={form.remarks} maxLength={500} invalid={!!errors.remarks} onChange={(e) => set('remarks', e.target.value)} onBlur={() => blur('remarks')} />
            </Field>
            <ErrorNote error={formError} className="sm:col-span-2" />
          </div>
        )}
      </Modal>
    </div>
  )
}
