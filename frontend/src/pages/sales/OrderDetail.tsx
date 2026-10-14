// S4 Order detail: used by the Sales Admin, the Production Manager and the Super Admin.
import { ArrowLeft, Ban, ExternalLink, FileText, Pencil, Share2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ImageStrip } from '../../components/AuthImage'
import { Button, Card, ErrorNote, Facts, Notice, PageHeader, Pill, SectionTitle, Spinner, StatusBadge, cx, errText, useLoad, useUi } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { dims, fmtDate, fmtDateTime, hoursLabel, money } from '../../lib/format'

interface HistoryRow { stage: string; kind?: string; started_at?: string; ended_at?: string; hours?: number; user?: string; note?: string }
interface Item {
  id: number; item_no: string; product_code?: string; product_name?: string; category?: string; product_desc?: string; design_desc?: string
  height?: number; width?: number; length?: number; final_height?: number; final_width?: number; final_length?: number
  colour_code?: string; colour_name?: string; wood_category?: string; seasoning?: string
  upholstery_needed?: boolean; upholstery_added?: boolean; amount?: number
  stage: string; status: string; days_in_stage?: number; delayed?: boolean; rework?: boolean; rework_count?: number
  site?: string; site_name?: string; apm?: string; assigned_at?: string
  finish_good_at?: string; packed_at?: string; ready_at?: string; delivered_at?: string; delivery_date?: string; delivered_by?: string; receiver_name?: string
  qc_ref?: string; images?: { file: string; name?: string }[]; history?: HistoryRow[]
  report?: { id: number; report_no?: string; status?: string }
}
interface Order {
  id: number; order_no?: string; status: string; state: string; customer: string; customer_code?: string; customer_phone?: string
  customer_address?: string; branch?: string; sales_admin?: string; order_date?: string; promised_date?: string; amount?: number
  item_count?: number; return_reason?: string; cancel_reason?: string; editable?: boolean; items: Item[]
}

const KIND_LABEL: Record<string, string> = { rework: 'Rework', reversal: 'Reversal', assign: 'Assigned', reassign: 'Reassigned' }
const kindLabel = (k?: string) => (!k || k === 'move' ? '' : KIND_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1))

function Timeline({ history }: { history: HistoryRow[] }) {
  return (
    <ol className="relative ml-1.5 border-l-2 border-slate-200">
      {history.map((h, i) => {
        const current = !h.ended_at && i === history.length - 1
        const bad = h.kind === 'rework' || h.kind === 'reversal'
        const kind = kindLabel(h.kind)
        return (
          <li key={i} className="relative pb-4 pl-5 last:pb-0">
            <span className={cx('absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-white ring-1',
              bad ? 'bg-red-500 ring-red-300' : current ? 'bg-blue-600 ring-blue-200' : 'bg-slate-400 ring-slate-200')} aria-hidden />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-brand-950">{h.stage}</span>
              {kind && <Pill tone={bad ? 'red' : 'brand'}>{kind}</Pill>}
              {current && <Pill tone="brand">Current</Pill>}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {[h.started_at ? fmtDateTime(h.started_at) : '', h.hours !== undefined ? `${current ? 'so far ' : ''}${hoursLabel(h.hours)}` : '', h.user ? `by ${h.user}` : '']
                .filter(Boolean).join(' · ')}
            </p>
            {h.note && <p className="mt-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">{h.note}</p>}
          </li>
        )
      })}
    </ol>
  )
}

export default function OrderDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user, refreshBadges } = useAuth()
  const { toast, confirm } = useUi()
  const [busy, setBusy] = useState(false)
  const { data: o, loading, error, reload } = useLoad<Order>(() => api.get(`/orders/${id}`), [id])

  const role = user?.role
  const isSales = role === 'Sales Admin', isPm = role === 'Production Manager', isSuper = role === 'Super Admin'
  const listPath = isSales ? '/sales/orders' : '/orders'
  const back = <Link to={listPath}><Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>Order Records</Button></Link>

  if (loading && !o) return <Spinner />
  if (error || !o) return <div><PageHeader title="Order" actions={back} /><ErrorNote error={error || 'Order not found.'} /></div>

  const items = o.items ?? []
  const ref = o.order_no ?? 'this draft order'
  const allUnassigned = o.state === 'placed' && !!o.editable
  const anyDelivered = items.some((i) => i.stage === 'Delivered')

  const act = async (path: 'return' | 'cancel') => {
    const reason = await confirm(path === 'return'
      ? { title: `Return ${ref} to the Sales Admin`, message: 'The Sales Admin will be asked to correct the order and place it again.', reason: 'Reason for returning', reasonRequired: true, confirmLabel: 'Return order', tone: 'warn' }
      : { title: `Cancel ${ref}`, message: 'A cancelled order stays in the records but leaves production. This cannot be undone.', reason: 'Reason for cancelling', reasonRequired: true, confirmLabel: 'Cancel order', tone: 'danger' })
    if (typeof reason !== 'string') return
    setBusy(true)
    try {
      const res = await api.post(`/orders/${o.id}/${path}`, { reason })
      toast.success(res.message)
      refreshBadges()
      reload()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title={o.order_no ? `Order ${o.order_no}` : 'Draft order'}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /><span>{o.customer}</span></span>}
        actions={<>
          {back}
          {(isSales || isSuper) && o.editable && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => nav(`/sales/orders/${o.id}/edit`)}>Edit order</Button>}
          {(isPm || isSuper) && o.status === 'Pending' && <Link to="/pm/distribution"><Button icon={<Share2 className="h-4 w-4" />}>Assign in Work Distribution</Button></Link>}
          {(isPm || isSuper) && allUnassigned && <Button variant="secondary" loading={busy} icon={<Undo2 className="h-4 w-4" />} onClick={() => act('return')}>Return to Sales Admin</Button>}
          {isSuper && !['Delivered', 'Cancelled'].includes(o.status) && !anyDelivered && (
            <Button variant="danger" loading={busy} icon={<Ban className="h-4 w-4" />} onClick={() => act('cancel')}>Cancel order</Button>
          )}
        </>} />

      <div className="space-y-3">
        {o.return_reason && <Notice tone="warn"><span className="font-semibold">Returned by the Production Manager:</span> {o.return_reason}</Notice>}
        {o.cancel_reason && o.status === 'Cancelled' && <Notice tone="warn"><span className="font-semibold">Order cancelled:</span> {o.cancel_reason}</Notice>}
        {isSales && o.state === 'placed' && !o.editable && o.status !== 'Cancelled' && (
          <Notice>This order is with production and can no longer be edited.</Notice>
        )}

        <Card title="Order summary">
          <Facts cols={4} items={[
            ['Order No.', o.order_no],
            ['Status', <StatusBadge status={o.status} />],
            ['Customer', o.customer],
            ['Customer ID', o.customer_code],
            ['Phone', o.customer_phone],
            ['Address', o.customer_address],
            ['Branch', o.branch],
            ['Sales Admin', o.sales_admin],
            [o.order_no ? 'Order Date' : 'Created', o.order_date ? fmtDate(o.order_date) : null],
            ['Promised Delivery Date', o.promised_date ? fmtDate(o.promised_date) : null],
            ['Items', items.length || null],
            ['Order Amount', o.amount ? money(o.amount) : null],
          ]} />
        </Card>
      </div>

      <SectionTitle>Items ({items.length})</SectionTitle>
      {items.length === 0 ? <Card><p className="text-sm text-slate-500">This order has no items yet.</p></Card> : (
        <div className="space-y-5">
          {items.map((it) => {
            const finalDims = it.final_height || it.final_width || it.final_length ? dims(it.final_height, it.final_width, it.final_length) : null
            const history = it.history ?? []
            return (
              <Card key={it.id}
                title={<span className="flex flex-wrap items-center gap-2">
                  <span>{it.product_name || 'Item'}</span>
                  <span className="text-xs font-semibold text-slate-500">{it.item_no}</span>
                </span>}
                actions={<>
                  <StatusBadge status={it.status} />
                  {it.stage && it.stage !== it.status && !['Draft', 'Cancelled'].includes(it.status) && <StatusBadge status={it.stage} />}
                  {it.delayed && <StatusBadge status="Delayed" />}
                  {it.rework && it.status !== 'Rework' && <StatusBadge status="Rework" />}
                  {!!it.rework_count && <Pill tone="red">Rework ×{it.rework_count}</Pill>}
                  {it.report && (
                    <Link to={`/reports/${it.report.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 hover:underline">
                      <FileText className="h-4 w-4" /> Production Report
                    </Link>
                  )}
                  {(isPm || isSuper) && (
                    <Link to={`/items/${it.id}`}><Button variant="secondary" size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />}>Open item</Button></Link>
                  )}
                </>}>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="min-w-0 space-y-5">
                    <ImageStrip images={it.images} />
                    <Facts cols={3} items={[
                      ['Product', it.product_name],
                      ['Product Code', it.product_code],
                      ['Category', it.category],
                      ['Measurements (H / W / L)', it.height || it.width || it.length ? dims(it.height, it.width, it.length) : null],
                      ['Final Measurements (H / W / L)', finalDims],
                      ['Colour', [it.colour_name, it.colour_code].filter(Boolean).join(' · ') || null],
                      ['Wood Category', it.wood_category],
                      ['Wood Seasoning', it.seasoning],
                      ['Upholstery', it.upholstery_needed ? 'Yes' : it.upholstery_added ? 'Added in production' : 'No'],
                      ['Amount', it.amount ? money(it.amount) : null],
                      ['Site', [it.site, it.site_name].filter(Boolean).join(' · ') || null],
                      ['Assistant Production Manager', it.apm],
                      ['Assigned', it.assigned_at ? fmtDateTime(it.assigned_at) : null],
                      ['Days in current stage', it.days_in_stage !== undefined ? it.days_in_stage : null],
                      ['QC Reference', it.qc_ref],
                      ['Finish Good', it.finish_good_at ? fmtDateTime(it.finish_good_at) : null],
                      ['Packed', it.packed_at ? fmtDateTime(it.packed_at) : null],
                      ['Ready for Delivery', it.ready_at ? fmtDateTime(it.ready_at) : null],
                      ['Delivered', it.delivery_date ? fmtDate(it.delivery_date) : it.delivered_at ? fmtDateTime(it.delivered_at) : null],
                      ['Delivered By', it.delivered_by],
                      ['Received By', it.receiver_name],
                    ]} />
                    {it.product_desc && (
                      <div>
                        <p className="text-xs font-medium text-slate-500">Product Description</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-800">{it.product_desc}</p>
                      </div>
                    )}
                    {it.design_desc && (
                      <div>
                        <p className="text-xs font-medium text-slate-500">Design Description</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-800">{it.design_desc}</p>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Stage timeline</p>
                    {history.length ? <Timeline history={history} />
                      : <p className="text-sm text-slate-500">{o.state === 'draft' ? 'The timeline starts when the order is placed.' : 'Waiting to be assigned to a site.'}</p>}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
