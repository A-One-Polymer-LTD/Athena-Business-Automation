// G1 Product Warehouse: finished items waiting to be packed, made ready and delivered.
import { Box, Download, PackageCheck, Search, Truck, Warehouse } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthImage } from '../../components/AuthImage'
import {
  Button, Card, Empty, ErrorNote, Field, Input, Modal, Notice, PageHeader, Spinner, StatCard, StatusBadge, errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { exportRows } from '../../lib/export'
import { fmtDate, todayISO } from '../../lib/format'

interface Item {
  id: number
  item_no: string
  order_no?: string
  customer: string
  product_code?: string
  product_name?: string
  site?: string
  stage: string
  status: string
  image?: string
  promised_date?: string
  delayed?: boolean
  finish_good_at?: string
  packed_at?: string
  ready_at?: string
}

const STAGES = ['In Warehouse', 'Packed', 'Ready for Delivery'] as const
type Stage = (typeof STAGES)[number]
const NEXT: Record<Stage, { label: string; action: 'pack' | 'ready' | 'deliver'; variant: 'primary' | 'gold' | 'success' }> = {
  'In Warehouse': { label: 'Mark Packed', action: 'pack', variant: 'primary' },
  Packed: { label: 'Mark Ready for Delivery', action: 'ready', variant: 'gold' },
  'Ready for Delivery': { label: 'Mark Delivered', action: 'deliver', variant: 'success' },
}

export default function WarehouseList() {
  const { toast, confirm } = useUi()
  const { refreshBadges } = useAuth()
  const { data, loading, error, reload } = useLoad<Item[]>(() => api.get('/items?scope=warehouse'))
  const [filter, setFilter] = useState<Stage | ''>('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(0)
  const [lastMsg, setLastMsg] = useState('')

  const [deliver, setDeliver] = useState<Item | null>(null)
  const [form, setForm] = useState({ delivery_date: todayISO(), delivered_by: '', receiver_name: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const all = data ?? []
  const count = (s: Stage) => all.filter((i) => i.stage === s).length
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all
      .filter((i) => !filter || i.stage === filter)
      .filter((i) => !needle || [i.item_no, i.customer, i.product_name, i.product_code, i.site].some((v) => (v ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => STAGES.indexOf(b.stage as Stage) - STAGES.indexOf(a.stage as Stage) || (a.finish_good_at ?? '').localeCompare(b.finish_good_at ?? ''))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, q])

  const done = () => { reload(); refreshBadges() }

  const step = async (it: Item) => {
    const next = NEXT[it.stage as Stage]
    if (!next) return
    if (next.action === 'deliver') {
      setForm({ delivery_date: todayISO(), delivered_by: '', receiver_name: '' })
      setErrors({})
      setFormError('')
      setDeliver(it)
      return
    }
    const target = next.action === 'pack' ? 'Packed' : 'Ready for Delivery'
    const ok = await confirm({
      title: `Mark ${it.item_no} as ${target}?`,
      message: <>{it.product_name} for {it.customer}. Once saved, this step can be undone only by the Super Admin.</>,
      confirmLabel: next.label,
    })
    if (!ok) return
    setBusy(it.id)
    try {
      const r = await api.post(`/items/${it.id}/warehouse`, { action: next.action })
      toast.success(r.message)
      done()
    } catch (e) { toast.error(errText(e)) } finally { setBusy(0) }
  }

  const submitDelivery = async () => {
    if (!deliver) return
    const e: Record<string, string> = {}
    if (!form.delivery_date) e.delivery_date = 'Please enter Delivery Date.'
    else if (form.delivery_date > todayISO()) e.delivery_date = 'Delivery Date cannot be in the future.'
    if (form.delivered_by.trim().length < 2) e.delivered_by = 'Please enter who delivered the item.'
    if (form.receiver_name.trim().length < 2) e.receiver_name = 'Please enter the name of the person who received it.'
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    setFormError('')
    try {
      const r = await api.post(`/items/${deliver.id}/warehouse`, {
        action: 'deliver', delivery_date: form.delivery_date, delivered_by: form.delivered_by.trim(), receiver_name: form.receiver_name.trim(),
      })
      toast.success(r.message)
      setLastMsg(r.message)
      setDeliver(null)
      done()
    } catch (err) { setFormError(errText(err)) } finally { setSaving(false) }
  }

  const doExport = () => exportRows('Product warehouse', rows.map((i) => ({
    'Item No.': i.item_no, Product: i.product_name ?? '', 'Product code': i.product_code ?? '', Customer: i.customer, Site: i.site ?? '',
    'Finish Good': i.finish_good_at ? fmtDate(i.finish_good_at) : '', Packed: i.packed_at ? fmtDate(i.packed_at) : '',
    'Ready for Delivery': i.ready_at ? fmtDate(i.ready_at) : '', 'Promised delivery': i.promised_date ? fmtDate(i.promised_date) : '', Status: i.status,
  })))

  return (
    <>
      <PageHeader title="Product Warehouse" subtitle="Finished items. Pack each one, mark it ready, then record the delivery." />

      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <>
          {lastMsg && <Notice tone="success" className="mb-4"><span className="font-semibold">{lastMsg}</span></Notice>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="In Warehouse" value={count('In Warehouse')} hint="Waiting to be packed" icon={<Warehouse className="h-5 w-5" />} tone="gold"
              active={filter === 'In Warehouse'} onClick={() => setFilter(filter === 'In Warehouse' ? '' : 'In Warehouse')} />
            <StatCard label="Packed" value={count('Packed')} hint="Waiting to be made ready" icon={<Box className="h-5 w-5" />} tone="brand"
              active={filter === 'Packed'} onClick={() => setFilter(filter === 'Packed' ? '' : 'Packed')} />
            <StatCard label="Ready for Delivery" value={count('Ready for Delivery')} hint="Waiting for delivery" icon={<Truck className="h-5 w-5" />} tone="teal"
              active={filter === 'Ready for Delivery'} onClick={() => setFilter(filter === 'Ready for Delivery' ? '' : 'Ready for Delivery')} />
          </div>

          <div className="mb-3 mt-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, customer, product…" aria-label="Search"
                className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-11 pr-3 text-[15px] placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
            {filter && <Button variant="ghost" size="lg" onClick={() => setFilter('')}>Show all</Button>}
            <Button variant="secondary" size="lg" className="ml-auto" icon={<Download className="h-5 w-5" />} onClick={doExport} disabled={!rows.length}>Excel</Button>
          </div>

          {rows.length === 0 ? (
            <Card><Empty icon={<PackageCheck className="h-6 w-6" />}
              title={all.length ? 'No items match' : 'The warehouse is empty'}
              hint={all.length ? 'Try a different search or show all items.' : 'Items appear here as soon as production marks them Finish Good.'} /></Card>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {rows.map((it) => {
                const next = NEXT[it.stage as Stage]
                return (
                  <div key={it.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
                    <div className="flex gap-3">
                      <AuthImage file={it.image} alt={it.product_name} className="h-20 w-20 shrink-0 rounded-lg border border-slate-200" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                          <Link to={`/items/${it.id}`} className="font-display text-[15px] font-bold text-brand-900 hover:underline">{it.item_no}</Link>
                          <span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={it.status} />{it.delayed && <StatusBadge status="Delayed" />}</span>
                        </div>
                        <p className="truncate text-sm font-semibold text-brand-950">{it.product_name}{it.product_code ? <span className="font-normal text-slate-500"> · {it.product_code}</span> : null}</p>
                        <p className="truncate text-sm text-slate-600">{it.customer}</p>
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                          {it.site && <span>Site <b className="font-semibold text-slate-700">{it.site}</b></span>}
                          {it.finish_good_at && <span>Finish Good <b className="font-semibold text-slate-700">{fmtDate(it.finish_good_at)}</b></span>}
                          {it.packed_at && <span>Packed <b className="font-semibold text-slate-700">{fmtDate(it.packed_at)}</b></span>}
                          {it.ready_at && <span>Ready <b className="font-semibold text-slate-700">{fmtDate(it.ready_at)}</b></span>}
                          {it.promised_date && <span>Promised <b className="font-semibold text-slate-700">{fmtDate(it.promised_date)}</b></span>}
                        </p>
                      </div>
                    </div>
                    {next && (
                      <Button size="lg" variant={next.variant} className="w-full" loading={busy === it.id} disabled={!!busy}
                        icon={next.action === 'deliver' ? <Truck className="h-5 w-5" /> : next.action === 'ready' ? <PackageCheck className="h-5 w-5" /> : <Box className="h-5 w-5" />}
                        onClick={() => step(it)}>{next.label}</Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <Modal open={!!deliver} onClose={() => { if (!saving) setDeliver(null) }} title={deliver ? `Mark ${deliver.item_no} Delivered` : ''}
        footer={<>
          <Button size="lg" variant="secondary" onClick={() => setDeliver(null)} disabled={saving}>Cancel</Button>
          <Button size="lg" variant="success" icon={<Truck className="h-5 w-5" />} loading={saving} onClick={submitDelivery}>Mark Delivered</Button>
        </>}>
        {deliver && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700"><b className="text-brand-950">{deliver.product_name}</b> for <b className="text-brand-950">{deliver.customer}</b></p>
            <Notice tone="warn">
              <b>Delivered cannot be undone.</b> The record is kept permanently, and the Production Report for this item is generated automatically.
            </Notice>
            <ErrorNote error={formError} />
            <Field label="Delivery Date" required error={errors.delivery_date} hint="Today or an earlier date.">
              <Input type="date" className="!h-12 !text-base" max={todayISO()} value={form.delivery_date} invalid={!!errors.delivery_date}
                onChange={(e) => { setForm({ ...form, delivery_date: e.target.value }); setErrors({ ...errors, delivery_date: '' }) }} />
            </Field>
            <Field label="Delivered By" required error={errors.delivered_by}>
              <Input className="!h-12 !text-base" maxLength={100} value={form.delivered_by} invalid={!!errors.delivered_by} placeholder="Name of the delivery person"
                onChange={(e) => { setForm({ ...form, delivered_by: e.target.value }); setErrors({ ...errors, delivered_by: '' }) }} />
            </Field>
            <Field label="Receiver Name" required error={errors.receiver_name}>
              <Input className="!h-12 !text-base" maxLength={100} value={form.receiver_name} invalid={!!errors.receiver_name} placeholder="Person who received the item"
                onChange={(e) => { setForm({ ...form, receiver_name: e.target.value }); setErrors({ ...errors, receiver_name: '' }) }} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}
