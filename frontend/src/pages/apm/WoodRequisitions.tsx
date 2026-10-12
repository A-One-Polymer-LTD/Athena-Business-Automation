// A3 Wood Requisitions: the APM's own records, the requisition form, and edit-and-resubmit for returned ones.
import { Pencil, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, ErrorNote, Facts, Field, Input, Modal, Notice, PageHeader, Select, Spinner, StatusBadge, Tabs, errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDate, fmtDateTime, num, type Period } from '../../lib/format'
import { PeriodFilter, inPeriod, useRequisitionItem, type MasterRow } from './StoreRequisitions'

export interface WoodReq {
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
  site?: string
  wood_category: string
  seasoning: string
  quantity: number
  measurement: string
  versions?: { version: number; submitted_at?: string; return_reason?: string; returned_by?: string; wood_category?: string; seasoning?: string; quantity?: number; measurement?: string }[]
}

const qty = (v?: number | null) => (v === undefined || v === null ? '—' : num(v, Number.isInteger(v) ? 0 : 2))

/**
 * Wood requisition form. Used in a Modal on the records screen and on the item screen (`itemId` fixes the item).
 * With `editing` (a returned requisition) it resubmits under the same number as a new version.
 */
export function WoodRequisitionForm({ itemId, editing, onDone, onCancel }: {
  itemId?: number; editing?: WoodReq; onDone: (message: string) => void; onCancel: () => void
}) {
  const { toast } = useUi()
  const meta = useLoad<any>(() => api.get('/meta'))
  const pick = useRequisitionItem(itemId, !!editing)
  const [wood, setWood] = useState(editing?.wood_category ?? '')
  const [seasoning, setSeasoning] = useState(editing?.seasoning ?? '')
  const [quantity, setQuantity] = useState(editing ? String(editing.quantity) : '')
  const [measurement, setMeasurement] = useState(editing?.measurement ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const woods: MasterRow[] = meta.data?.masters?.wood ?? []
  const seasonings: MasterRow[] = meta.data?.masters?.seasoning ?? []
  const item = pick.item

  // Wood category and seasoning default from the chosen item.
  useEffect(() => {
    if (editing || !item) return
    setWood(item.wood_category ?? '')
    setSeasoning(item.seasoning ?? '')
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => { setErrors({}); setFormError('') }

  const submit = async () => {
    if (busy) return
    const e: Record<string, string> = {}
    if (!editing && !pick.id) e.item = 'Please select the item.'
    if (!woods.some((w) => w.name === wood)) e.wood = 'Please select a Wood Category from the list.'
    if (!seasonings.some((s) => s.name === seasoning)) e.seasoning = 'Please select Wood Seasoning from the list.'
    const n = Number(quantity)
    if (!quantity.trim() || !Number.isFinite(n) || n <= 0) e.quantity = 'Quantity of Wood must be more than 0.'
    if (!measurement.trim()) e.measurement = 'Please enter Measurement of Wood.'
    setErrors(e)
    if (Object.keys(e).length) return
    const body = { wood_category: wood, seasoning, quantity: n, measurement: measurement.trim() }
    setBusy(true)
    setFormError('')
    try {
      const res = editing
        ? await api.put<{ message: string }>(`/wood-requisitions/${editing.id}`, body)
        : await api.post<{ message: string }>('/wood-requisitions', { item_id: pick.id, ...body })
      onDone(res.message)
    } catch (err) {
      setFormError(errText(err))
      toast.error(errText(err))
      setBusy(false)
    }
  }

  if (meta.loading) return <Spinner />
  if (meta.error) return <ErrorNote error={meta.error} />

  const product = editing ? { item_no: editing.item_no, product_name: editing.product_name, product_code: undefined, product_desc: undefined } : item

  return (
    <div className="space-y-4">
      {editing?.return_reason && (
        <Notice tone="warn"><span className="font-semibold">Returned by the Saw-Mill Supervisor:</span> {editing.return_reason}</Notice>
      )}
      {!editing && !itemId && (
        <Field label="Item" required error={errors.item}>
          {pick.loadingList ? <p className="py-2 text-sm text-slate-500">Loading your items…</p> : (
            <Select value={pick.id || ''} invalid={!!errors.item} onChange={(e) => { pick.setId(Number(e.target.value)); clear() }}>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Wood Category" required error={errors.wood}>
          <Select value={wood} invalid={!!errors.wood} onChange={(e) => { setWood(e.target.value); clear() }}>
            <option value="">Select wood…</option>
            {woods.map((w) => <option key={w.code} value={w.name}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Wood Seasoning" required error={errors.seasoning}>
          <Select value={seasoning} invalid={!!errors.seasoning} onChange={(e) => { setSeasoning(e.target.value); clear() }}>
            <option value="">Select seasoning…</option>
            {seasonings.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Quantity of Wood" required error={errors.quantity}>
          <Input type="number" inputMode="decimal" min={0} step="any" value={quantity} invalid={!!errors.quantity} onChange={(e) => { setQuantity(e.target.value); clear() }} />
        </Field>
        <Field label="Measurement of Wood" required error={errors.measurement} hint="For example: 6 ft x 4 in x 2 in">
          <Input value={measurement} maxLength={200} invalid={!!errors.measurement} onChange={(e) => { setMeasurement(e.target.value); clear() }} />
        </Field>
      </div>

      <ErrorNote error={formError} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="lg" loading={busy} onClick={submit}>{editing ? 'Resubmit Requisition' : 'Submit Requisition'}</Button>
      </div>
    </div>
  )
}

type StatusTab = 'All' | 'Submitted' | 'In Progress' | 'Completed' | 'Returned'
const TABS: StatusTab[] = ['All', 'Submitted', 'In Progress', 'Completed', 'Returned']

export default function WoodRequisitions() {
  const { toast } = useUi()
  const { refreshBadges } = useAuth()
  const { data, loading, error, reload } = useLoad<WoodReq[]>(() => api.get('/wood-requisitions'))
  const [tab, setTab] = useState<StatusTab>('All')
  const [period, setPeriod] = useState<Period | null>(null)
  const [creating, setCreating] = useState(false)
  const [viewId, setViewId] = useState<number | null>(null)
  const [editing, setEditing] = useState<WoodReq | null>(null)

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

  const columns: Column<WoodReq>[] = [
    { key: 'req_no', header: 'Requisition No.', render: (r) => <span className="font-semibold text-brand-900">{r.req_no}</span> },
    { key: 'submitted_at', header: 'Submitted', value: (r) => r.submitted_at?.slice(0, 10), render: (r) => fmtDate(r.submitted_at) },
    { key: 'item_no', header: 'Item' },
    { key: 'product_name', header: 'Product' },
    { key: 'site', header: 'Site' },
    { key: 'wood_category', header: 'Wood Category' },
    { key: 'seasoning', header: 'Seasoning' },
    { key: 'quantity', header: 'Quantity', align: 'right', render: (r) => qty(r.quantity) },
    { key: 'measurement', header: 'Measurement' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'version', header: 'Version', align: 'right', value: (r) => (r.version > 1 ? r.version : null) },
    { key: 'return_reason', header: 'Return reason', render: (r) => <span className="block max-w-[260px] truncate font-medium text-orange-800">{r.return_reason}</span> },
    { key: 'processed_by', header: 'Processed by' },
  ]

  return (
    <div>
      <PageHeader title="Wood Requisitions" subtitle="Wood requests you sent to the Saw-Mill Supervisor."
        actions={<Button size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>New Wood Requisition</Button>} />

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
          <DataTable<WoodReq> rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => setViewId(r.id)}
            exportName="Wood Requisitions" searchPlaceholder="Search Requisition No.…"
            emptyTitle="No wood requisitions found" emptyHint="Use “New Wood Requisition” to request wood for an item."
            rowClassName={(r) => (r.status === 'Returned' ? 'bg-orange-50/50' : undefined)} />
        </>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New Wood Requisition" size="lg">
        {creating && <WoodRequisitionForm onDone={done} onCancel={() => setCreating(false)} />}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit and resubmit ${editing.req_no}` : ''} size="lg">
        {editing && <WoodRequisitionForm editing={editing} onDone={done} onCancel={() => setEditing(null)} />}
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
              ['Item No.', view.item_no], ['Product Name', view.product_name], ['Site', view.site],
              ['Wood Category', view.wood_category], ['Wood Seasoning', view.seasoning], ['Quantity of Wood', qty(view.quantity)],
              ['Measurement of Wood', view.measurement], ['Version', view.version > 1 ? `Version ${view.version}` : null],
              ['Submitted', view.submitted_at ? fmtDateTime(view.submitted_at) : null],
              ['Processed', view.processed_at ? fmtDateTime(view.processed_at) : null], ['Processed by', view.processed_by],
            ]} />
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
                      <p className="mt-1 text-sm text-slate-700">
                        {[v.wood_category, v.seasoning, v.quantity !== undefined ? `Qty ${qty(v.quantity)}` : null, v.measurement].filter(Boolean).join(' · ')}
                      </p>
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
