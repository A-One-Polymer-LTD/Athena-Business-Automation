// P1 Orders: new and returned orders waiting for the Production Manager, oldest first.
import { CheckCircle2, Clock, ExternalLink, Send, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ImageStrip } from '../../components/AuthImage'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, Card, Empty, ErrorNote, Facts, Modal, Notice, PageHeader, Pill, Select, Spinner, StatusBadge, Tabs,
  errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { dims, fmtDate, fmtDateTime, hoursLabel, money } from '../../lib/format'

interface Order {
  id: number
  order_no?: string
  status: string
  state: string
  customer: string
  customer_code?: string
  customer_phone?: string
  customer_address?: string
  branch?: string
  sales_admin?: string
  order_date: string
  promised_date?: string
  amount?: number
  item_count: number
  products?: string
  return_reason?: string
}
interface OrderItem {
  id: number
  item_no: string
  product_code?: string
  product_name?: string
  category?: string
  product_desc?: string
  design_desc?: string
  height?: number
  width?: number
  length?: number
  colour_code?: string
  colour_name?: string
  wood_category?: string
  seasoning?: string
  upholstery_needed?: boolean
  amount?: number
  stage: string
  status: string
  site?: string
  site_name?: string
  apm?: string
  images?: { file: string; name?: string }[]
}
interface OrderFull extends Order { items: OrderItem[] }
interface Site { id: number; code: string; name: string; type?: string; active: boolean; apm?: string; open_items?: number }

type Tab = 'pending' | 'returned' | 'all'

const waitingHours = (iso: string) => Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5)
const siteLabel = (s: Site) =>
  `${s.code} — ${s.name} · ${s.apm ?? 'No APM mapped'} · ${s.open_items ?? 0} open item${s.open_items === 1 ? '' : 's'}`

function useWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return wide
}

export default function PmOrders() {
  const navigate = useNavigate()
  const wide = useWide()
  const { refreshBadges } = useAuth()
  const [tab, setTab] = useState<Tab>('pending')
  const [sel, setSel] = useState<number | null>(null)

  const queue = useLoad<Order[]>(() => api.get('/orders?status=Pending,Returned'))
  const all = useLoad<Order[] | null>(() => (tab === 'all' ? api.get('/orders') : Promise.resolve(null)), [tab === 'all'])
  const meta = useLoad<{ sites: Site[] }>(() => api.get('/meta'))

  const byAge = (a: Order, b: Order) => a.order_date.localeCompare(b.order_date)
  const pending = useMemo(() => (queue.data ?? []).filter((o) => o.status === 'Pending').sort(byAge), [queue.data])
  const returned = useMemo(() => (queue.data ?? []).filter((o) => o.status === 'Returned').sort(byAge), [queue.data])
  const rows = tab === 'pending' ? pending : returned
  const sites = useMemo(() => (meta.data?.sites ?? []).filter((s) => s.active), [meta.data])

  // keep the selection valid; on wide screens always show the oldest order
  useEffect(() => {
    if (tab === 'all' || queue.loading) return
    if (sel !== null && !rows.some((o) => o.id === sel)) setSel(null)
    else if (sel === null && wide && rows.length) setSel(rows[0].id)
  }, [tab, rows, sel, wide, queue.loading])

  const changed = () => { queue.reload(); meta.reload(); refreshBadges() }

  const queueColumns: Column<Order>[] = [
    // customer and order date sit under the order number and the waiting time, so the queue fits beside the details panel
    {
      key: 'order_no', header: 'Order',
      render: (o) => <div className="min-w-0"><p className="font-semibold text-brand-900">{o.order_no}</p><p className="max-w-[190px] truncate text-xs text-slate-500">{o.customer}</p></div>,
    },
    { key: 'customer', header: 'Customer', hidden: true },
    { key: 'item_count', header: 'Items', align: 'right' },
    { key: 'amount', header: 'Amount', align: 'right', render: (o) => money(o.amount) },
    { key: 'order_date', header: 'Order date', hidden: true, value: (o) => (o.order_date || '').slice(0, 10) },
    {
      key: 'waiting', header: 'Waiting', value: (o) => Math.round(waitingHours(o.order_date)),
      render: (o) => (
        <div>
          <p className="inline-flex items-center gap-1 whitespace-nowrap text-slate-700"><Clock className="h-3.5 w-3.5" />{hoursLabel(waitingHours(o.order_date))}</p>
          <p className="whitespace-nowrap text-xs text-slate-500">{fmtDate(o.order_date)}</p>
        </div>
      ),
    },
  ]
  const allColumns: Column<Order>[] = [
    { key: 'order_no', header: 'Order No.', render: (o) => <span className="font-semibold text-brand-900">{o.order_no}</span> },
    { key: 'customer', header: 'Customer' },
    { key: 'branch', header: 'Branch' },
    { key: 'sales_admin', header: 'Sales Admin' },
    { key: 'products', header: 'Products', className: 'max-w-64 truncate' },
    { key: 'item_count', header: 'Items', align: 'right' },
    { key: 'amount', header: 'Amount', align: 'right', render: (o) => money(o.amount) },
    { key: 'order_date', header: 'Order date', render: (o) => fmtDate(o.order_date) },
    { key: 'promised_date', header: 'Promised', render: (o) => (o.promised_date ? fmtDate(o.promised_date) : null) },
    { key: 'status', header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
  ]

  return (
    <>
      <PageHeader title="Orders" subtitle="New orders from the showrooms, oldest first. Assign every item to a production site, or return the order to the Sales Admin for correction." />
      <Tabs<Tab> className="mb-4" value={tab} onChange={(t) => { setTab(t); setSel(null) }}
        options={[
          { value: 'pending', label: 'Pending', count: pending.length },
          { value: 'returned', label: 'Returned to Sales Admin', count: returned.length },
          { value: 'all', label: 'All orders' },
        ]} />

      {tab === 'all' ? (
        all.loading ? <Spinner /> : all.error ? <ErrorNote error={all.error} /> : (
          <DataTable rows={all.data ?? []} columns={allColumns} rowKey={(o) => o.id} exportName="Orders"
            searchPlaceholder="Search Order No., customer, product…" onRowClick={(o) => navigate(`/orders/${o.id}`)}
            emptyTitle="No orders yet" />
        )
      ) : queue.loading ? <Spinner /> : queue.error ? <ErrorNote error={queue.error} /> : rows.length === 0 ? (
        <Card><Empty icon={<CheckCircle2 className="h-6 w-6" />}
          title={tab === 'pending' ? 'No orders are waiting' : 'No returned orders'}
          hint={tab === 'pending' ? 'Every placed order has been assigned to a production site.' : 'Orders you return to the Sales Admin stay here until they are corrected and resubmitted.'} /></Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <DataTable rows={rows} columns={queueColumns} rowKey={(o) => o.id} dense exportName={tab === 'pending' ? 'Pending orders' : 'Returned orders'}
            searchPlaceholder="Search Order No. or customer…" onRowClick={(o) => setSel(o.id)}
            rowClassName={(o) => (o.id === sel ? 'bg-brand-50 shadow-[inset_3px_0_0_0_var(--color-brand-800)]' : undefined)} />
          {wide && (
            <Card title="Order details" className="sticky top-4">
              {sel ? <OrderPanel key={sel} id={sel} sites={sites} onChanged={changed} /> : <Empty title="Select an order" hint="Choose an order from the list to see its items and assign them." />}
            </Card>
          )}
        </div>
      )}

      <Modal open={!wide && sel !== null && tab !== 'all'} onClose={() => setSel(null)} title="Order details" size="lg">
        {sel !== null && <OrderPanel key={sel} id={sel} sites={sites} onChanged={changed} />}
      </Modal>
    </>
  )
}

function OrderPanel({ id, sites, onChanged }: { id: number; sites: Site[]; onChanged: () => void }) {
  const { toast, confirm } = useUi()
  const { data: o, loading, error, reload } = useLoad<OrderFull>(() => api.get(`/orders/${id}`), [id])
  const [pick, setPick] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState('')

  if (loading && !o) return <Spinner />
  if (error) return <ErrorNote error={error} />
  if (!o) return null

  const placed = o.state === 'placed'
  const unassigned = o.items.filter((i) => i.stage === 'Unassigned')
  const canReturn = placed && o.items.length > 0 && unassigned.length === o.items.length

  const assign = async (it: OrderItem) => {
    const site_id = Number(pick[it.id])
    if (!site_id) { toast.warn('Please select a site for this item first.'); return }
    setBusy(`assign-${it.id}`)
    try {
      const r = await api.post(`/items/${it.id}/assign`, { site_id })
      toast.success(r.message)
      reload()
      onChanged()
    } catch (e) { toast.error(errText(e)) } finally { setBusy('') }
  }

  const returnOrder = async () => {
    const reason = await confirm({
      title: `Return ${o.order_no ?? 'order'} to the Sales Admin?`,
      message: 'The Sales Admin will be asked to correct the order and submit it again. Please say what needs to be corrected.',
      confirmLabel: 'Return order', tone: 'warn', reason: 'Reason for returning', reasonRequired: true,
    })
    if (typeof reason !== 'string') return
    setBusy('return')
    try {
      const r = await api.post(`/orders/${o.id}/return`, { reason })
      toast.success(r.message)
      reload()
      onChanged()
    } catch (e) { toast.error(errText(e)) } finally { setBusy('') }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-lg font-bold text-brand-950">{o.order_no}</p>
          <p className="text-sm text-slate-500">{o.customer}{o.customer_code ? ` · ${o.customer_code}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={o.status} />
          <Link to={`/orders/${o.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 hover:underline">
            Full record <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {o.return_reason && <Notice tone="warn"><b>Returned to the Sales Admin:</b> {o.return_reason}</Notice>}

      <Facts cols={3} items={[
        ['Customer', o.customer],
        ['Phone', o.customer_phone],
        ['Address', o.customer_address],
        ['Branch', o.branch],
        ['Sales Admin', o.sales_admin],
        ['Order date', fmtDateTime(o.order_date)],
        ['Promised delivery', o.promised_date ? fmtDate(o.promised_date) : null],
        ['Items', o.item_count],
        ['Order amount', o.amount !== undefined ? money(o.amount) : null],
      ]} />

      <div className="space-y-3">
        {o.items.map((it) => (
          <div key={it.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-brand-950">{it.item_no}{it.product_name ? ` · ${it.product_name}` : ''}</p>
                {(it.product_code || it.category) && <p className="text-xs text-slate-500">{[it.product_code, it.category].filter(Boolean).join(' · ')}</p>}
              </div>
              <div className="flex items-center gap-2">
                {it.upholstery_needed && <Pill tone="gold">Upholstery</Pill>}
                <StatusBadge status={it.status} />
              </div>
            </div>
            {!!it.images?.length && <div className="mb-3"><ImageStrip images={it.images} /></div>}
            <Facts cols={3} items={[
              ['Product description', it.product_desc],
              ['Design description', it.design_desc],
              ['Height / Width / Length', it.height || it.width || it.length ? dims(it.height, it.width, it.length) : null],
              ['Colour', [it.colour_name, it.colour_code].filter(Boolean).join(' · ')],
              ['Wood', [it.wood_category, it.seasoning].filter(Boolean).join(' · ')],
              ['Amount', it.amount !== undefined ? money(it.amount) : null],
              ['Site', it.site ? [it.site, it.site_name].filter(Boolean).join(' — ') : null],
              ['APM', it.apm],
            ]} />
            {placed && it.stage === 'Unassigned' && (
              <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Select aria-label={`Site for ${it.item_no}`} value={pick[it.id] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [it.id]: e.target.value }))}>
                    <option value="">Select a production site…</option>
                    {sites.map((s) => <option key={s.id} value={s.id} disabled={!s.apm}>{siteLabel(s)}</option>)}
                  </Select>
                </div>
                <Button icon={<Send className="h-4 w-4" />} loading={busy === `assign-${it.id}`} disabled={!!busy || !pick[it.id]} onClick={() => assign(it)}>Assign</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {placed && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="max-w-md text-xs text-slate-500">
            {canReturn ? 'An order can be returned to the Sales Admin only while none of its items is assigned.'
              : 'This order can no longer be returned because an item has been assigned to a site.'}
          </p>
          <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} loading={busy === 'return'} disabled={!canReturn || !!busy} onClick={returnOrder}>
            Return to Sales Admin
          </Button>
        </div>
      )}
    </div>
  )
}
