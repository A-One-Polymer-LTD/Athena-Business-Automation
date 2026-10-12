// A2 Store Requisitions: the APM's own records, the requisition form, and edit-and-resubmit for returned ones.
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, ErrorNote, Facts, Field, Input, Modal, Notice, PageHeader, PeriodPicker, Select, Spinner, StatusBadge, Tabs,
  cx, errText, useLoad, useUi,
} from '../../components/ui'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { currentPeriod, fmtDate, fmtDateTime, num, periodRange, type Period } from '../../lib/format'

export interface MasterRow { code: string; name: string; category?: string; unit?: string }

export interface StoreReqLine {
  id?: number
  material_code: string
  material_name?: string
  category?: string
  details?: string
  measurement?: string
  quantity: number
  issued_qty?: number
  colour_code?: string
  remarks?: string
}
export interface StoreReq {
  id: number
  req_no: string
  status: string
  version: number
  return_reason?: string
  submitted_at?: string
  processed_at?: string
  processed_by?: string
  apm?: string
  item_id: number
  item_no: string
  order_no?: string
  product_name?: string
  product_code?: string
  product_desc?: string
  site?: string
  lines: StoreReqLine[]
  versions?: { version: number; submitted_at?: string; return_reason?: string; returned_by?: string; lines?: StoreReqLine[] }[]
}

/** Item chooser shared by the store and wood requisition forms. With a fixed item the list is not loaded. */
export function useRequisitionItem(fixedId?: number, skip = false) {
  const [id, setId] = useState<number>(fixedId ?? 0)
  const list = useLoad<any[]>(() => (fixedId || skip ? Promise.resolve([]) : api.get('/items?scope=production')), [fixedId, skip])
  const detail = useLoad<any | null>(() => (id && !skip ? api.get(`/items/${id}`) : Promise.resolve(null)), [id, skip])
  const item = detail.data && detail.data.id === id ? detail.data : null
  return { id, setId, items: list.data ?? [], item, loadingList: list.loading, loadingItem: !!id && detail.loading, error: list.error || detail.error }
}

/** Searchable select over a master list: type a code or a name, then pick from the list. */
export function CodePicker({ options, value, onChange, invalid, placeholder = 'Search code or name…', label }: {
  options: MasterRow[]; value: string; onChange: (code: string) => void; invalid?: boolean; placeholder?: string; label?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = options.find((o) => o.code === value)
  const needle = q.trim().toLowerCase()
  const shown = (needle ? options.filter((o) => `${o.code} ${o.name} ${o.category ?? ''}`.toLowerCase().includes(needle)) : options).slice(0, 60)
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false) }}>
      <Input aria-label={label} role="combobox" aria-expanded={open} autoComplete="off" invalid={invalid} placeholder={placeholder}
        value={open ? q : selected ? `${selected.code} · ${selected.name}` : value}
        onFocus={() => { setQ(''); setOpen(true) }} onClick={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
          if (e.key === 'Enter' && open && shown.length) { e.preventDefault(); onChange(shown[0].code); setOpen(false) }
        }} />
      {open && (
        <ul role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop">
          {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-500">No code matches “{q}”. Please select a code from the list.</li>}
          {shown.map((o) => (
            <li key={o.code} role="option" aria-selected={o.code === value}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o.code); setOpen(false) }}
                className={cx('flex w-full items-baseline gap-2 px-3 py-2.5 text-left text-sm hover:bg-brand-50', o.code === value && 'bg-brand-50')}>
                <span className="tabular font-semibold text-brand-900">{o.code}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{o.name}</span>
                {o.category && <span className="shrink-0 text-xs text-slate-500">{o.category}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface DraftLine { key: number; material_code: string; details: string; measurement: string; quantity: string; colour_code: string; remarks: string }
let lineSeq = 0
const blankLine = (): DraftLine => ({ key: ++lineSeq, material_code: '', details: '', measurement: '', quantity: '', colour_code: '', remarks: '' })

/**
 * Store requisition form. Used in a Modal on the records screen and on the item screen (`itemId` fixes the item).
 * With `editing` (a returned requisition) it resubmits under the same number as a new version.
 */
export function StoreRequisitionForm({ itemId, editing, onDone, onCancel }: {
  itemId?: number; editing?: StoreReq; onDone: (message: string) => void; onCancel: () => void
}) {
  const { toast, confirm } = useUi()
  const meta = useLoad<any>(() => api.get('/meta'))
  const pick = useRequisitionItem(itemId, !!editing)
  const [lines, setLines] = useState<DraftLine[]>(() => editing
    ? editing.lines.map((l) => ({ key: ++lineSeq, material_code: l.material_code, details: l.details ?? '', measurement: l.measurement ?? '', quantity: String(l.quantity ?? ''), colour_code: l.colour_code ?? '', remarks: l.remarks ?? '' }))
    : [blankLine()])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const materials: MasterRow[] = meta.data?.masters?.material ?? []
  const colours: MasterRow[] = meta.data?.masters?.colour ?? []
  const product = editing
    ? { item_no: editing.item_no, product_name: editing.product_name, product_code: editing.product_code, product_desc: editing.product_desc }
    : pick.item

  const setLine = (key: number, patch: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setErrors({})
    setFormError('')
  }
  const chooseMaterial = (l: DraftLine, code: string) => {
    const mat = materials.find((x) => x.code === code)
    setLine(l.key, { material_code: code, measurement: l.measurement || mat?.unit || '' })
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!editing && !pick.id) e.item = 'Please select the item.'
    lines.forEach((l) => {
      if (!l.material_code) e[`code${l.key}`] = 'Please select a Raw Material Code.'
      else if (!materials.some((x) => x.code === l.material_code)) e[`code${l.key}`] = `Code ${l.material_code} was not found. Please select a code from the list.`
      const qty = Number(l.quantity)
      if (!l.quantity.trim() || !Number.isFinite(qty) || qty <= 0) e[`qty${l.key}`] = 'Quantity must be more than 0.'
    })
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    if (busy || !validate()) return
    const payload = lines.map((l) => ({
      material_code: l.material_code, details: l.details.trim(), measurement: l.measurement.trim(), quantity: Number(l.quantity),
      colour_code: l.colour_code, remarks: l.remarks.trim(),
    }))
    setBusy(true)
    setFormError('')
    try {
      let res: { message: string }
      if (editing) res = await api.put(`/store-requisitions/${editing.id}`, { lines: payload })
      else {
        try {
          res = await api.post('/store-requisitions', { item_id: pick.id, lines: payload })
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409 && err.code === 'duplicate')) throw err
          const go = await confirm({ title: 'Possible duplicate requisition', message: err.message, confirmLabel: 'Submit anyway', tone: 'warn' })
          if (!go) { setBusy(false); return }
          res = await api.post('/store-requisitions', { item_id: pick.id, lines: payload, confirm_duplicate: true })
        }
      }
      onDone(res.message)
    } catch (err) {
      setFormError(errText(err))
      toast.error(errText(err))
      setBusy(false)
    }
  }

  if (meta.loading) return <Spinner />
  if (meta.error) return <ErrorNote error={meta.error} />

  return (
    <div className="space-y-4">
      {editing?.return_reason && (
        <Notice tone="warn"><span className="font-semibold">Returned by the Store Operator:</span> {editing.return_reason}</Notice>
      )}
      {!editing && !itemId && (
        <Field label="Item" required error={errors.item}>
          {pick.loadingList ? <p className="py-2 text-sm text-slate-500">Loading your items…</p> : (
            <Select value={pick.id || ''} invalid={!!errors.item} onChange={(e) => { pick.setId(Number(e.target.value)); setErrors({}) }}>
              <option value="">Select an item in production…</option>
              {pick.items.map((i) => <option key={i.id} value={i.id}>{i.item_no} · {i.product_name} · {i.customer} ({i.stage})</option>)}
            </Select>
          )}
        </Field>
      )}
      <ErrorNote error={pick.error} />
      {pick.loadingItem && <p className="text-sm text-slate-500">Loading product details…</p>}
      {product && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <Facts cols={3} items={[
            ['Item No.', product.item_no], ['Product Name', product.product_name], ['Product Code', product.product_code],
            ['Product Description', product.product_desc],
          ]} />
        </div>
      )}

      <div className="space-y-3">
        {lines.map((l, idx) => {
          const mat = materials.find((x) => x.code === l.material_code)
          return (
            <div key={l.key} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold uppercase tracking-wider text-brand-900">Material line {idx + 1}</p>
                {lines.length > 1 && (
                  <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Raw Material Code" required error={errors[`code${l.key}`]} className="sm:col-span-2">
                  <CodePicker label="Raw Material Code" options={materials} value={l.material_code} invalid={!!errors[`code${l.key}`]} onChange={(code) => chooseMaterial(l, code)} />
                </Field>
                <Field label="Category"><Input readOnly disabled value={mat?.category ?? ''} placeholder="Fills in from the code" /></Field>
                <Field label="Raw Material Name"><Input readOnly disabled value={mat?.name ?? ''} placeholder="Fills in from the code" /></Field>
                <Field label="Raw Material Details" className="sm:col-span-2">
                  <Input value={l.details} maxLength={200} onChange={(e) => setLine(l.key, { details: e.target.value })} />
                </Field>
                <Field label="Measurement"><Input value={l.measurement} maxLength={60} placeholder={mat?.unit || 'e.g. yard, kg, pcs'} onChange={(e) => setLine(l.key, { measurement: e.target.value })} /></Field>
                <Field label="Quantity" required error={errors[`qty${l.key}`]}>
                  <Input type="number" inputMode="decimal" min={0} step="any" value={l.quantity} invalid={!!errors[`qty${l.key}`]} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                </Field>
                <Field label="Colour Code">
                  <Select value={l.colour_code} onChange={(e) => setLine(l.key, { colour_code: e.target.value })}>
                    <option value="">No colour</option>
                    {colours.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                    {l.colour_code && !colours.some((c) => c.code === l.colour_code) && <option value={l.colour_code}>{l.colour_code}</option>}
                  </Select>
                </Field>
                <Field label="Remarks / Issue" className="sm:col-span-2 lg:col-span-3">
                  <Input value={l.remarks} maxLength={300} onChange={(e) => setLine(l.key, { remarks: e.target.value })} />
                </Field>
              </div>
            </div>
          )
        })}
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((ls) => [...ls, blankLine()])}>Add material line</Button>
      </div>

      <ErrorNote error={formError} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="lg" loading={busy} onClick={submit}>{editing ? 'Resubmit Requisition' : 'Submit Requisition'}</Button>
      </div>
    </div>
  )
}

/** Lines of a store requisition as a compact table. */
export function StoreLinesTable({ lines }: { lines: StoreReqLine[] }) {
  const has = (k: keyof StoreReqLine) => lines.some((l) => l[k] !== undefined && l[k] !== null && l[k] !== '')
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2">Code</th><th className="px-3 py-2">Raw Material</th>
            {has('category') && <th className="px-3 py-2">Category</th>}
            {has('details') && <th className="px-3 py-2">Details</th>}
            {has('measurement') && <th className="px-3 py-2">Measurement</th>}
            <th className="px-3 py-2 text-right">Quantity</th>
            {has('issued_qty') && <th className="px-3 py-2 text-right">Issued</th>}
            {has('colour_code') && <th className="px-3 py-2">Colour</th>}
            {has('remarks') && <th className="px-3 py-2">Remarks / Issue</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="border-t border-slate-100">
              <td className="tabular px-3 py-2 font-semibold text-brand-900">{l.material_code}</td>
              <td className="px-3 py-2">{l.material_name ?? '—'}</td>
              {has('category') && <td className="px-3 py-2">{l.category ?? '—'}</td>}
              {has('details') && <td className="px-3 py-2">{l.details ?? '—'}</td>}
              {has('measurement') && <td className="px-3 py-2">{l.measurement ?? '—'}</td>}
              <td className="tabular px-3 py-2 text-right">{num(l.quantity, Number.isInteger(l.quantity) ? 0 : 2)}</td>
              {has('issued_qty') && <td className="tabular px-3 py-2 text-right">{l.issued_qty === undefined || l.issued_qty === null ? '—' : num(l.issued_qty, Number.isInteger(l.issued_qty) ? 0 : 2)}</td>}
              {has('colour_code') && <td className="px-3 py-2">{l.colour_code ?? '—'}</td>}
              {has('remarks') && <td className="px-3 py-2">{l.remarks ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "All dates" or a Monthly / Quarterly / Yearly period, for the requisition record lists. */
export function PeriodFilter({ value, onChange }: { value: Period | null; onChange: (p: Period | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-40">
        <Select aria-label="Date filter" value={value ? 'period' : 'all'} onChange={(e) => onChange(e.target.value === 'all' ? null : currentPeriod('monthly'))}>
          <option value="all">All dates</option>
          <option value="period">Filter by period</option>
        </Select>
      </div>
      {value && <PeriodPicker value={value} onChange={onChange} />}
    </div>
  )
}
export const inPeriod = (iso: string | undefined, p: Period | null) => {
  if (!p) return true
  if (!iso) return false
  const { from, to } = periodRange(p)
  const d = iso.slice(0, 10)
  return d >= from && d <= to
}

type StatusTab = 'All' | 'Submitted' | 'Issued' | 'Partly Issued' | 'Returned'
const TABS: StatusTab[] = ['All', 'Submitted', 'Issued', 'Partly Issued', 'Returned']

export default function StoreRequisitions() {
  const { toast } = useUi()
  const { refreshBadges } = useAuth()
  const { data, loading, error, reload } = useLoad<StoreReq[]>(() => api.get('/store-requisitions'))
  const [tab, setTab] = useState<StatusTab>('All')
  const [period, setPeriod] = useState<Period | null>(null)
  const [creating, setCreating] = useState(false)
  const [viewId, setViewId] = useState<number | null>(null)
  const [editing, setEditing] = useState<StoreReq | null>(null)

  const inRange = useMemo(() => (data ?? []).filter((r) => inPeriod(r.submitted_at, period)), [data, period])
  const rows = useMemo(() => (tab === 'All' ? inRange : inRange.filter((r) => r.status === tab)), [inRange, tab])
  const view = (data ?? []).find((r) => r.id === viewId) ?? null
  const returned = inRange.filter((r) => r.status === 'Returned')

  const done = (message: string) => {
    toast.success(message)
    setCreating(false)
    setEditing(null)
    setViewId(null)
    reload()
    refreshBadges()
  }

  const columns: Column<StoreReq>[] = [
    { key: 'req_no', header: 'Requisition No.', render: (r) => <span className="font-semibold text-brand-900">{r.req_no}</span> },
    { key: 'submitted_at', header: 'Submitted', value: (r) => r.submitted_at?.slice(0, 10), render: (r) => fmtDate(r.submitted_at) },
    { key: 'item_no', header: 'Item' },
    { key: 'product_name', header: 'Product' },
    { key: 'site', header: 'Site' },
    { key: 'materials', header: 'Materials', value: (r) => r.lines.map((l) => `${l.material_code} ${l.material_name ?? ''}`.trim()).join(', '),
      render: (r) => <span className="block max-w-[280px] truncate">{r.lines.map((l) => l.material_name ?? l.material_code).join(', ')}</span> },
    { key: 'line_count', header: 'Lines', align: 'right', value: (r) => r.lines.length },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'version', header: 'Version', align: 'right', value: (r) => (r.version > 1 ? r.version : null) },
    { key: 'return_reason', header: 'Return reason', render: (r) => <span className="block max-w-[260px] truncate font-medium text-orange-800">{r.return_reason}</span> },
    { key: 'processed_by', header: 'Processed by' },
  ]

  return (
    <div>
      <PageHeader title="Store Requisitions" subtitle="Raw material requests you sent to the Store Operator."
        actions={<Button size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>New Store Requisition</Button>} />

      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <>
          {returned.length > 0 && (
            <Notice tone="warn" className="mb-4">
              <span className="font-semibold">{returned.length} requisition{returned.length > 1 ? 's were' : ' was'} returned.</span> Open {returned.length > 1 ? 'each one' : 'it'} to see the reason, then edit and resubmit.
            </Notice>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Tabs<StatusTab> value={tab} onChange={setTab}
              options={TABS.map((t) => ({ value: t, label: t, count: t === 'All' ? undefined : inRange.filter((r) => r.status === t).length }))} />
            <PeriodFilter value={period} onChange={setPeriod} />
          </div>
          <DataTable<StoreReq> rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => setViewId(r.id)}
            exportName="Store Requisitions" searchPlaceholder="Search Requisition No.…"
            emptyTitle="No store requisitions found" emptyHint="Use “New Store Requisition” to request raw materials for an item."
            rowClassName={(r) => (r.status === 'Returned' ? 'bg-orange-50/50' : undefined)} />
        </>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New Store Requisition" size="xl">
        {creating && <StoreRequisitionForm onDone={done} onCancel={() => setCreating(false)} />}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit and resubmit ${editing.req_no}` : ''} size="xl">
        {editing && <StoreRequisitionForm editing={editing} onDone={done} onCancel={() => setEditing(null)} />}
      </Modal>

      <Modal open={!!view && !editing} onClose={() => setViewId(null)} size="lg"
        title={view ? <span className="flex flex-wrap items-center gap-2">{view.req_no} <StatusBadge status={view.status} /></span> : ''}
        footer={view && <>
          <Button variant="secondary" onClick={() => setViewId(null)}>Close</Button>
          {view.status === 'Returned' && <Button variant="gold" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(view)}>Edit and resubmit</Button>}
        </>}>
        {view && (
          <div className="space-y-4">
            {view.status === 'Returned' && (
              <div role="alert" className="rounded-lg border-2 border-orange-300 bg-orange-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-orange-800">Returned{view.processed_by ? ` by ${view.processed_by}` : ''}</p>
                <p className="mt-1 text-[15px] font-semibold text-orange-900">{view.return_reason || 'No reason was recorded.'}</p>
              </div>
            )}
            <Facts cols={3} items={[
              ['Item No.', view.item_no], ['Product Name', view.product_name], ['Product Code', view.product_code],
              ['Product Description', view.product_desc], ['Site', view.site], ['Version', view.version > 1 ? `Version ${view.version}` : null],
              ['Submitted', view.submitted_at ? fmtDateTime(view.submitted_at) : null],
              ['Processed', view.processed_at ? fmtDateTime(view.processed_at) : null], ['Processed by', view.processed_by],
            ]} />
            <StoreLinesTable lines={view.lines} />
            {view.versions && view.versions.length > 0 && (
              <div>
                <p className="mb-2 border-l-4 border-gold-400 pl-3 text-[13px] font-bold uppercase tracking-wider text-brand-900">Version history</p>
                <div className="space-y-3">
                  {[...view.versions].reverse().map((v) => (
                    <div key={v.version} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm font-semibold text-brand-950">
                        Version {v.version}{v.submitted_at ? ` · submitted ${fmtDateTime(v.submitted_at)}` : ''}
                      </p>
                      {v.return_reason && <p className="mt-1 text-sm text-orange-800">Returned{v.returned_by ? ` by ${v.returned_by}` : ''}: {v.return_reason}</p>}
                      {v.lines && v.lines.length > 0 && <div className="mt-2"><StoreLinesTable lines={v.lines} /></div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
