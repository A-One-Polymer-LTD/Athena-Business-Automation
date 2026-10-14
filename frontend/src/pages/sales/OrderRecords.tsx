// S3 Order Records: Sales Admin (own branch), Production Manager and Super Admin (all placed orders).
import { Pencil, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, ErrorNote, PageHeader, Spinner, StatusBadge, useLoad } from '../../components/ui'
import { api, qs } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDate, money, num } from '../../lib/format'

interface OrderRow {
  id: number; order_no?: string; status: string; customer: string; customer_code?: string; customer_phone?: string
  products?: string; product_codes?: string; categories?: string; item_count: number; amount: number; order_date: string
  branch?: string; sales_admin?: string; editable?: boolean
}

const STATUSES = ['Draft', 'Pending', 'Returned', 'In Production', 'Completed', 'Partly Delivered', 'Delivered', 'Cancelled']
const FILTER = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'

export default function OrderRecords() {
  const { user } = useAuth()
  const nav = useNavigate()
  const isSales = user?.role === 'Sales Admin'
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const meta = useLoad<any>(() => api.get('/meta'), [])
  const query = qs({ status, category, date_from: from, date_to: to })
  const list = useLoad<OrderRow[]>(() => api.get(`/orders${query}`), [query])

  const categories = useMemo(() => {
    const set = new Set<string>()
    ;((meta.data?.masters?.product ?? []) as { category?: string }[]).forEach((p) => { if (p.category) set.add(p.category) })
    return [...set].sort()
  }, [meta.data])

  // Super Admin and Production Manager never see drafts
  const statusOptions = STATUSES.filter((s) => isSales || s !== 'Draft')
  const combined = status && !statusOptions.includes(status) ? status : ''
  const setStatus = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('status', v); else next.delete('status')
    setParams(next, { replace: true })
  }
  const filtered = !!(status || category || from || to)
  const clear = () => { setStatus(''); setCategory(''); setFrom(''); setTo('') }

  const columns: Column<OrderRow>[] = [
    { key: 'order_no', header: 'Order No.', always: true, render: (r) => (r.order_no ? <span className="font-semibold text-brand-900">{r.order_no}</span> : <span className="italic text-slate-400">Not placed</span>) },
    { key: 'customer', header: 'Customer', render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'customer_code', header: 'Customer ID' },
    { key: 'products', header: 'Products', render: (r) => (r.products ? <span className="block max-w-[260px] truncate" title={r.products}>{r.products}</span> : null) },
    { key: 'product_codes', header: 'Product Codes', render: (r) => (r.product_codes ? <span className="block max-w-[200px] truncate" title={r.product_codes}>{r.product_codes}</span> : null) },
    { key: 'categories', header: 'Category' },
    { key: 'item_count', header: 'Items', align: 'right', render: (r) => num(r.item_count) },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amount) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'order_date', header: 'Order Date', value: (r) => (r.order_date || '').slice(0, 10), render: (r) => <span className="whitespace-nowrap">{fmtDate(r.order_date)}</span> },
  ]
  if (!isSales) {
    columns.splice(3, 0, { key: 'branch', header: 'Branch' })
    columns.splice(4, 0, { key: 'sales_admin', header: 'Sales Admin' })
  } else {
    columns.push({
      key: 'actions', header: '', noExport: true, align: 'right',
      render: (r) => (r.editable ?? (r.status === 'Draft' || r.status === 'Returned') ? (
        <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />}
          onClick={(e) => { e.stopPropagation(); nav(`/sales/orders/${r.id}/edit`) }}>Edit</Button>
      ) : null),
    })
  }

  return (
    <div>
      <PageHeader title="Order Records"
        subtitle={isSales ? `Customer orders of ${user?.branch ?? 'your branch'}` : 'Customer orders of all branches'}
        actions={(isSales || user?.role === 'Super Admin') && <Link to="/sales/orders/new"><Button icon={<Plus className="h-4 w-4" />}>New Order</Button></Link>} />

      {list.error ? <ErrorNote error={list.error} /> : list.loading && !list.data ? <Spinner /> : (
        <DataTable<OrderRow> rows={list.data ?? []} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => nav(`/orders/${r.id}`)}
          exportName="Order Records" searchPlaceholder="Search order, customer, product…"
          initialSort={{ key: 'order_date', dir: 'desc' }}
          emptyTitle={filtered ? 'No orders match these filters' : 'No orders yet'}
          emptyHint={filtered ? 'Change or clear the filters to see more orders.' : isSales ? 'Place a new order to see it here.' : 'Placed orders will appear here.'}
          filters={<>
            <select aria-label="Status" className={FILTER} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {combined && <option value={combined}>{combined.split(',').join(' + ')}</option>}
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {categories.length > 0 && (
              <select aria-label="Category" className={FILTER} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">From
              <input type="date" aria-label="Order date from" className={FILTER} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">To
              <input type="date" aria-label="Order date to" className={FILTER} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
            {filtered && <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={clear}>Clear</Button>}
          </>} />
      )}
    </div>
  )
}
