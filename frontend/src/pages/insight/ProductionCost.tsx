// P5 Production Cost: items with their recorded cost, and cost reports (FR-PC-08, FR-PC-09).
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, Empty, ErrorNote, Input, PageHeader, Select, Spinner, StatCard, StatusBadge, Tabs, cx, useLoad } from '../../components/ui'
import { api, qs } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { exportRows } from '../../lib/export'
import { MONTH_NAMES, compact, money, num } from '../../lib/format'

interface CostItem {
  id: number; item_no: string; order_no: string; order_id: number; customer?: string; product_name?: string; product_code?: string
  category?: string; site?: string; stage?: string; status?: string; amount?: number; order_date?: string; delivery_date?: string
  sheet_no?: string; lines: number; total_cost: number
}
interface CostSummary {
  categories: { category: string; items: number; cost: number; order_amount: number; avg_cost: number }[]
  months: { month: string; cost: number }[]
  orders: { order_id: number; order_no: string; customer?: string; items: number; cost: number; amount: number }[]
  total: number
}

const axisTick = { fontSize: 11, fill: '#64748b' }
const monthLabel = (ym: string) => `${MONTH_NAMES[+ym.slice(5, 7) - 1] ?? ''} ${ym.slice(0, 4)}`
const uniq = (list: (string | undefined)[]) => [...new Set(list.filter(Boolean) as string[])].sort()
const Margin = ({ v }: { v: number }) => <span className={cx('font-semibold', v >= 0 ? 'text-emerald-700' : 'text-red-600')}>{money(v)}</span>

function Items({ isSuper }: { isSuper: boolean }) {
  const nav = useNavigate()
  const { data, loading, error } = useLoad<CostItem[]>(() => api.get('/cost/items'), [])
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [noCost, setNoCost] = useState(false)

  const all = data ?? []
  const rows = useMemo(() => all.filter((r) => (!status || r.status === status || r.stage === status) && (!category || r.category === category) && (!noCost || !r.lines)), [all, status, category, noCost])
  const statuses = useMemo(() => uniq(all.flatMap((r) => [r.status, r.stage])), [all])
  const categories = useMemo(() => uniq(all.map((r) => r.category)), [all])

  const columns: Column<CostItem>[] = [
    { key: 'item_no', header: 'Item No.', render: (r) => <span className="font-semibold text-brand-800">{r.item_no}</span> },
    { key: 'customer', header: 'Customer' },
    { key: 'product_name', header: 'Product', value: (r) => [r.product_name, r.product_code].filter(Boolean).join(' · '),
      render: (r) => <span>{r.product_name}{r.product_code && <span className="ml-1.5 text-xs text-slate-500">{r.product_code}</span>}</span> },
    { key: 'category', header: 'Category' },
    { key: 'site', header: 'Site' },
    { key: 'status', header: 'Status', value: (r) => r.status ?? r.stage, render: (r) => <StatusBadge status={r.status ?? r.stage} /> },
    { key: 'sheet_no', header: 'Cost Sheet No.' },
    { key: 'lines', header: 'Lines', align: 'right', always: true, render: (r) => (r.lines ? r.lines : <span className="text-xs text-slate-400">None</span>) },
    { key: 'total_cost', header: 'Total Recorded Production Cost', align: 'right', always: true, render: (r) => <span className="font-semibold text-brand-950">{money(r.total_cost, 2)}</span> },
    ...(isSuper ? [
      { key: 'amount', header: 'Order Amount', align: 'right', render: (r) => (r.amount ? money(r.amount) : null) },
      { key: 'margin', header: 'Margin', align: 'right', value: (r) => (r.amount ? r.amount - r.total_cost : null), render: (r) => (r.amount ? <Margin v={r.amount - r.total_cost} /> : null) },
    ] as Column<CostItem>[] : []),
  ]

  if (error) return <ErrorNote error={error} />
  if (loading && !data) return <Spinner />
  return (
    <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => nav(`/cost/${r.id}`)} exportName="Production Cost Items"
      searchPlaceholder="Search item, customer, product…" initialSort={{ key: 'item_no', dir: 'desc' }}
      emptyTitle="No items found" emptyHint="Items appear here once they are assigned to a production site."
      filters={<>
        <div className="w-full sm:w-44"><Select aria-label="Status" className="!h-9" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}
        </Select></div>
        <div className="w-full sm:w-44"><Select aria-label="Category" className="!h-9" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>{categories.map((s) => <option key={s}>{s}</option>)}
        </Select></div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-brand-700" checked={noCost} onChange={(e) => setNoCost(e.target.checked)} />
          No cost recorded yet
        </label>
      </>} />
  )
}

function Reports({ isSuper }: { isSuper: boolean }) {
  const nav = useNavigate()
  const { user } = useAuth()
  const canOpenOrder = user?.role === 'Super Admin' || user?.role === 'Production Manager' || user?.role === 'Sales Admin'
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data, loading, error } = useLoad<CostSummary>(() => api.get(`/cost/summary${qs({ date_from: from, date_to: to })}`), [from, to])

  const months = useMemo(() => (data?.months ?? []).map((m) => ({ ...m, label: monthLabel(m.month) })), [data])
  const catCols: Column<CostSummary['categories'][number]>[] = [
    { key: 'category', header: 'Category', render: (r) => <span className="font-semibold text-brand-950">{r.category}</span> },
    { key: 'items', header: 'Items', align: 'right' },
    { key: 'cost', header: 'Recorded Cost', align: 'right', render: (r) => money(r.cost, 2) },
    { key: 'avg_cost', header: 'Average per Item', align: 'right', render: (r) => money(r.avg_cost, 2) },
    ...(isSuper ? [
      { key: 'order_amount', header: 'Order Amount', align: 'right', render: (r) => (r.order_amount ? money(r.order_amount) : null) },
      { key: 'margin', header: 'Margin', align: 'right', value: (r) => (r.order_amount ? r.order_amount - r.cost : null), render: (r) => (r.order_amount ? <Margin v={r.order_amount - r.cost} /> : null) },
    ] as Column<CostSummary['categories'][number]>[] : []),
  ]
  const orderCols: Column<CostSummary['orders'][number]>[] = [
    { key: 'order_no', header: 'Order No.', render: (r) => <span className="font-semibold text-brand-800">{r.order_no}</span> },
    { key: 'customer', header: 'Customer' },
    { key: 'items', header: 'Items with Cost', align: 'right' },
    { key: 'cost', header: 'Recorded Cost', align: 'right', render: (r) => <span className="font-semibold">{money(r.cost, 2)}</span> },
    ...(isSuper ? [
      { key: 'amount', header: 'Order Amount', align: 'right', render: (r) => (r.amount ? money(r.amount) : null) },
      { key: 'margin', header: 'Margin', align: 'right', value: (r) => (r.amount ? r.amount - r.cost : null), render: (r) => (r.amount ? <Margin v={r.amount - r.cost} /> : null) },
    ] as Column<CostSummary['orders'][number]>[] : []),
  ]

  const exportMonths = () => exportRows('Production Cost by Month', months.map((m) => ({ Month: m.label, 'Recorded Cost': m.cost })))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-card no-print">
        <label className="block w-full min-[420px]:w-44"><span className="mb-1 block text-xs font-semibold text-slate-600">Entered from</span>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block w-full min-[420px]:w-44"><span className="mb-1 block text-xs font-semibold text-slate-600">Entered to</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        {(from || to) && <Button variant="ghost" onClick={() => { setFrom(''); setTo('') }}>Clear dates</Button>}
      </div>

      {error ? <ErrorNote error={error} /> : !data ? <Spinner /> : !data.categories.length ? (
        <Card><Empty title="No cost recorded in this period" hint="Change the date range, or record cost lines on an item's Production Cost Sheet." /></Card>
      ) : (
        <div className={cx('space-y-5', loading && 'opacity-60')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Total Recorded Production Cost" value={money(data.total, 2)} hint="Voided lines are excluded" />
            <StatCard label="Items with cost" value={num(data.categories.reduce((s, c) => s + c.items, 0))} />
            <StatCard label="Orders with cost" value={num(data.orders.length)} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Recorded cost per month" actions={<Button variant="secondary" size="sm" className="no-print" icon={<Download className="h-4 w-4" />} onClick={exportMonths}>Excel</Button>}>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => compact(Number(v))} />
                    <Tooltip formatter={(v: any) => [money(Number(v), 2), 'Recorded cost']} cursor={{ fill: '#faf5f5' }} />
                    <Bar dataKey="cost" fill="#d83533" radius={[3, 3, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Recorded cost per product category">
              <div className="w-full" style={{ height: Math.max(256, data.categories.length * 36 + 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.categories} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => compact(Number(v))} />
                    <YAxis type="category" dataKey="category" width={120} tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                    <Tooltip formatter={(v: any) => [money(Number(v), 2), 'Recorded cost']} cursor={{ fill: '#faf5f5' }} />
                    <Bar dataKey="cost" fill="#d4a63d" radius={[0, 3, 3, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div>
            <h2 className="mb-2 text-[15px] font-bold text-brand-950">Cost per product category</h2>
            <DataTable rows={data.categories} columns={catCols} rowKey={(r) => r.category} exportName="Production Cost by Category" searchable={false} />
          </div>
          <div>
            <h2 className="mb-2 text-[15px] font-bold text-brand-950">Cost per order</h2>
            <DataTable rows={data.orders} columns={orderCols} rowKey={(r) => r.order_id} exportName="Production Cost by Order" searchPlaceholder="Search order or customer…"
              onRowClick={canOpenOrder ? (r) => nav(`/orders/${r.order_id}`) : undefined} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProductionCost() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'items' | 'reports'>('items')
  const isSuper = user?.role === 'Super Admin'
  return (
    <div>
      <PageHeader title="Production Cost" subtitle={user?.cost_permission ? 'Record material and other expenses against each item' : 'Recorded production cost of each item (view only)'} />
      <Tabs value={tab} onChange={setTab} className="mb-4 no-print" options={[{ value: 'items', label: 'Items' }, { value: 'reports', label: 'Cost reports' }]} />
      {tab === 'items' ? <Items isSuper={isSuper} /> : <Reports isSuper={isSuper} />}
    </div>
  )
}
