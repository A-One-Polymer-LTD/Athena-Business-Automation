// G2 Delivery Records: permanent register of delivered items.
import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ImageStrip } from '../../components/AuthImage'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, ErrorNote, Facts, Modal, Notice, PageHeader, Spinner, StatusBadge, useLoad } from '../../components/ui'
import { api } from '../../lib/api'
import { dims, fmtDate, fmtDateTime, todayISO } from '../../lib/format'

interface Item {
  id: number
  item_no: string
  order_no?: string
  customer: string
  customer_code?: string
  branch?: string
  sales_admin?: string
  product_code?: string
  product_name?: string
  category?: string
  site?: string
  site_name?: string
  apm?: string
  status: string
  promised_date?: string
  order_date?: string
  finish_good_at?: string
  packed_at?: string
  ready_at?: string
  delivered_at?: string
  delivery_date?: string
  delivered_by?: string
  receiver_name?: string
  qc_ref?: string
}
interface ItemFull extends Item {
  product_desc?: string
  design_desc?: string
  colour_code?: string
  colour_name?: string
  wood_category?: string
  seasoning?: string
  height?: number
  width?: number
  length?: number
  final_height?: number
  final_width?: number
  final_length?: number
  upholstery_added?: boolean
  images?: { file: string; name?: string }[]
  report?: { id: number; report_no: string; status: string }
}

const day = (i: Item) => (i.delivery_date ?? i.delivered_at ?? '').slice(0, 10)
const DATE_INPUT = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-ink focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'

export default function DeliveryRecords() {
  const { data, loading, error } = useLoad<Item[]>(() => api.get('/items?scope=delivered'))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<Item | null>(null)

  const rows = useMemo(() => (data ?? [])
    .filter((i) => (!from || day(i) >= from) && (!to || day(i) <= to))
    .sort((a, b) => day(b).localeCompare(day(a))), [data, from, to])

  const columns: Column<Item>[] = [
    { key: 'item_no', header: 'Order / Item No.', render: (i) => <span className="font-semibold text-brand-900">{i.item_no}</span> },
    { key: 'customer', header: 'Customer' },
    { key: 'product_name', header: 'Product', render: (i) => <span>{i.product_name}{i.product_code ? <span className="text-slate-500"> · {i.product_code}</span> : null}</span> },
    { key: 'site', header: 'Site' },
    { key: 'delivery_date', header: 'Delivery Date', value: day, render: (i) => fmtDate(day(i)) },
    { key: 'delivered_by', header: 'Delivered By' },
    { key: 'receiver_name', header: 'Receiver' },
    { key: 'packed_at', header: 'Packed', value: (i) => i.packed_at?.slice(0, 10), render: (i) => (i.packed_at ? fmtDate(i.packed_at) : null) },
    { key: 'ready_at', header: 'Ready for Delivery', value: (i) => i.ready_at?.slice(0, 10), render: (i) => (i.ready_at ? fmtDate(i.ready_at) : null) },
  ]

  return (
    <>
      <PageHeader title="Delivery Records" subtitle="Every delivered item, with who delivered it and who received it." />
      <Notice className="mb-4">Delivered records are kept permanently and cannot be deleted.</Notice>

      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <DataTable rows={rows} columns={columns} rowKey={(i) => i.id} onRowClick={setOpen} exportName="Delivery records"
          searchPlaceholder="Search Order No. or customer…"
          emptyTitle={from || to ? 'No deliveries in this date range' : 'No deliveries yet'}
          emptyHint={from || to ? 'Change or clear the delivery date range.' : 'Items appear here once they are marked Delivered.'}
          filters={
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
              <label className="flex items-center gap-1.5">Delivered from
                <input type="date" aria-label="Delivered from" className={DATE_INPUT} value={from} max={to || todayISO()} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="flex items-center gap-1.5">to
                <input type="date" aria-label="Delivered to" className={DATE_INPUT} value={to} min={from || undefined} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
              </label>
              {(from || to) && <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo('') }}>Clear</Button>}
            </div>
          } />
      )}

      {open && <RecordModal item={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function RecordModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data, loading, error } = useLoad<ItemFull>(() => api.get(`/items/${item.id}`), [item.id])
  const d = data
  const sized = (h?: number, w?: number, l?: number) => (h || w || l ? dims(h, w, l) : null)
  return (
    <Modal open onClose={onClose} size="lg" title={<span className="flex flex-wrap items-center gap-2">{item.item_no} <StatusBadge status={item.status} /></span>}
      footer={<>
        <Link to={`/items/${item.id}`} className="mr-auto inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 hover:underline">
          Open full item record <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : d ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
            <Facts cols={3} items={[
              ['Delivery Date', day(d) ? fmtDate(day(d)) : null],
              ['Delivered By', d.delivered_by],
              ['Receiver', d.receiver_name],
              ['Recorded on', d.delivered_at ? fmtDateTime(d.delivered_at) : null],
              ['Production Report', d.report?.report_no],
              ['Report status', d.report ? <StatusBadge status={d.report.status} /> : null],
            ]} />
          </div>

          {!!d.images?.length && <ImageStrip images={d.images} />}

          <Facts cols={3} items={[
            ['Customer', [d.customer, d.customer_code].filter(Boolean).join(' · ')],
            ['Branch', d.branch],
            ['Sales Admin', d.sales_admin],
            ['Product', [d.product_name, d.product_code].filter(Boolean).join(' · ')],
            ['Category', d.category],
            ['Product description', d.product_desc],
            ['Design description', d.design_desc],
            ['Ordered Height / Width / Length', sized(d.height, d.width, d.length)],
            ['Final Height / Width / Length', sized(d.final_height, d.final_width, d.final_length)],
            ['Colour', [d.colour_name, d.colour_code].filter(Boolean).join(' · ')],
            ['Wood', [d.wood_category, d.seasoning].filter(Boolean).join(' · ')],
            ['Upholstery', d.upholstery_added ? 'Yes' : null],
            ['Site', [d.site, d.site_name].filter(Boolean).join(' — ')],
            ['APM', d.apm],
            ['QC report', d.qc_ref],
          ]} />

          <Facts cols={4} items={[
            ['Order date', d.order_date ? fmtDate(d.order_date) : null],
            ['Promised delivery', d.promised_date ? fmtDate(d.promised_date) : null],
            ['Finish Good', d.finish_good_at ? fmtDate(d.finish_good_at) : null],
            ['Packed', d.packed_at ? fmtDate(d.packed_at) : null],
            ['Ready for Delivery', d.ready_at ? fmtDate(d.ready_at) : null],
            ['Delivered', d.delivered_at ? fmtDate(d.delivered_at) : null],
          ]} />
        </div>
      ) : null}
    </Modal>
  )
}
