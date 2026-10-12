// X2 Management Dashboard: orders by status and period, items per stage and site, QC rates and delayed items.
import { AlertTriangle, Banknote, CheckCircle2, Clock, Factory, Layers, RefreshCw, ShoppingCart, Truck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, Empty, ErrorNote, Notice, PageHeader, PeriodPicker, Pill, SectionTitle, Spinner, StatCard, StatusBadge, useLoad } from '../../components/ui'
import { api, qs } from '../../lib/api'
import { compact, compactMoney, currentPeriod, fmtDate, money, num, type Period } from '../../lib/format'

interface Brief {
  id: number
  item_no: string
  customer: string
  product_name?: string
  product_code?: string
  site?: string
  apm?: string
  stage: string
  status: string
  days_in_stage?: number
  promised_date?: string
}
interface Dashboard {
  cards: { total_orders: number; total_amount: number; pending: number; in_production: number; completed: number; delivered: number }
  status: { status: string; count: number }[]
  series: { label: string; orders: number; amount: number }[]
  stages: { stage: string; count: number }[]
  sites: { site: string; count: number }[]
  qc: { checks: number; pass: number; rework: number; pass_rate?: number | null; rework_rate?: number | null }
  open_items: number
  delayed_count: number
  delayed: Brief[]
  unassigned: number
  in_warehouse: number
  label: string
}

const STATUS_COLOURS: Record<string, string> = {
  Pending: '#94a3b8', Returned: '#ea580c', 'In Production': '#4a6aa8', Completed: '#d4a63d', 'Partly Delivered': '#0d9488', Delivered: '#22355c',
}
const STATUS_ORDER = ['Pending', 'Returned', 'In Production', 'Completed', 'Partly Delivered', 'Delivered']
const FALLBACK = ['#22355c', '#4a6aa8', '#9cb2d9', '#d4a63d', '#059669', '#0d9488', '#dc2626', '#ea580c', '#94a3b8']
const WAREHOUSE_STAGES = ['In Warehouse', 'Packed', 'Ready for Delivery']
const AXIS = { fontSize: 12, fill: '#64748b' }

function ChartEmpty({ hint }: { hint: ReactNode }) {
  return <Empty title="No data for this view" hint={hint} />
}
const rate = (v?: number | null) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`)

export default function ManagementDashboard() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>(() => currentPeriod('monthly'))
  const [refreshing, setRefreshing] = useState(false)
  const { data, loading, error, reload } = useLoad<Dashboard>(
    () => api.get<Dashboard>(`/dashboard/management${qs({ mode: period.mode, year: period.year, period: period.period })}`).finally(() => setRefreshing(false)),
    [period.mode, period.year, period.period],
  )

  const c = data?.cards
  const status = data ? [...data.status].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) : []
  const statusTotal = status.reduce((s, x) => s + x.count, 0)
  const hasSeries = !!data?.series.some((s) => s.orders > 0 || s.amount > 0)
  const qc = data?.qc
  const qcData = qc ? [{ name: 'Pass', value: qc.pass, fill: '#059669' }, { name: 'Rework', value: qc.rework, fill: '#dc2626' }].filter((x) => x.value > 0) : []

  const delayedCols: Column<Brief>[] = [
    { key: 'item_no', header: 'Item No.', render: (r) => <Link to={`/items/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand-800 hover:underline">{r.item_no}</Link> },
    { key: 'customer', header: 'Customer' },
    { key: 'product_name', header: 'Product' },
    { key: 'site', header: 'Site' },
    { key: 'apm', header: 'APM' },
    { key: 'stage', header: 'Stage', render: (r) => <StatusBadge status={r.status} />, value: (r) => (r.status !== r.stage ? `${r.stage} (${r.status})` : r.stage) },
    { key: 'days_in_stage', header: 'Days in stage', align: 'right' },
    { key: 'promised_date', header: 'Due date', render: (r) => (r.promised_date ? <span className="font-semibold text-orange-700">{fmtDate(r.promised_date)}</span> : null) },
  ]

  return (
    <div>
      <PageHeader title="Management Dashboard"
        subtitle={data ? `Orders, production and quality for ${data.label}` : 'Orders, production and quality at a glance'}
        actions={<>
          <PeriodPicker value={period} onChange={setPeriod} />
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={refreshing} onClick={() => { setRefreshing(true); reload() }}>Refresh</Button>
        </>} />

      <ErrorNote error={error} className="mb-4" />
      {loading && !data ? <Spinner label="Loading dashboard…" /> : data && c && qc && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Orders" value={num(c.total_orders)} hint={data.label} icon={<ShoppingCart className="h-5 w-5" />} tone="brand" />
            <StatCard label="Order amount" value={compactMoney(c.total_amount)} hint={money(c.total_amount)} icon={<Banknote className="h-5 w-5" />} tone="gold" />
            <StatCard label="Pending" value={num(c.pending)} hint="Awaiting site assignment" icon={<Clock className="h-5 w-5" />} tone="slate" />
            <StatCard label="In production" value={num(c.in_production)} hint="Orders" icon={<Factory className="h-5 w-5" />} tone="brand" />
            <StatCard label="Completed" value={num(c.completed)} hint="Finished, not yet delivered" icon={<CheckCircle2 className="h-5 w-5" />} tone="gold" />
            <StatCard label="Delivered" value={num(c.delivered)} hint="Fully or partly delivered" icon={<Truck className="h-5 w-5" />} tone="teal" />
            <StatCard label="Open items" value={num(data.open_items)} hint={`${num(data.in_warehouse)} in warehouse · ${num(data.unassigned)} unassigned`} icon={<Layers className="h-5 w-5" />} tone="brand" onClick={() => navigate('/monitor')} />
            <StatCard label="Delayed" value={num(data.delayed_count)} hint="Open items, as of now" icon={<AlertTriangle className="h-5 w-5" />} tone="orange" />
          </div>
          <Notice className="mt-3">
            Drafts and cancelled orders are excluded from all totals. Order and QC figures are for {data.label}; open, delayed, stage and site figures show the position right now.
          </Notice>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Orders and order amount by period" subtitle={period.mode === 'monthly' ? `Six months to ${data.label}` : data.label}>
              {!hasSeries ? <ChartEmpty hint="No orders were placed in this period." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.series} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="orders" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={36} />
                      <YAxis yAxisId="amount" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v) => compact(Number(v))} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v, name) => [name === 'Order amount' ? money(Number(v)) : num(Number(v)), name]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#22355c" radius={[4, 4, 0, 0]} maxBarSize={42} />
                      <Line yAxisId="amount" type="monotone" dataKey="amount" name="Order amount" stroke="#d4a63d" strokeWidth={2.5} dot={{ r: 3, fill: '#d4a63d' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Order status" subtitle={data.label}>
              {statusTotal === 0 ? <ChartEmpty hint="No orders were placed in this period." /> : (
                <>
                  <div className="relative h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={status} dataKey="count" nameKey="status" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
                          {status.map((s, i) => <Cell key={s.status} fill={STATUS_COLOURS[s.status] ?? FALLBACK[i % FALLBACK.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v, name) => [num(Number(v)), name]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-2xl font-bold tabular text-brand-950">{num(statusTotal)}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Orders</span>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {status.map((s, i) => (
                      <li key={s.status} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-slate-700">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOURS[s.status] ?? FALLBACK[i % FALLBACK.length] }} />
                          <span className="truncate">{s.status}</span>
                        </span>
                        <span className="tabular font-semibold text-brand-950">{num(s.count)} <span className="font-normal text-slate-500">({Math.round((s.count / statusTotal) * 100)}%)</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Items per stage" subtitle="Open items, as of now">
              {data.stages.length === 0 ? <ChartEmpty hint="There are no open items in production or the warehouse." /> : (
                <div style={{ height: Math.max(140, data.stages.length * 28 + 30) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.stages} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                      <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="stage" width={140} tick={{ fontSize: 11.5, fill: '#334155' }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [num(Number(v)), 'Items']} />
                      <Bar dataKey="count" name="Items" radius={[0, 4, 4, 0]} barSize={15} label={{ position: 'right', fontSize: 12, fill: '#334155' }}>
                        {data.stages.map((s) => <Cell key={s.stage} fill={WAREHOUSE_STAGES.includes(s.stage) ? '#d4a63d' : /QC$/.test(s.stage) ? '#059669' : '#22355c'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Items per site" subtitle="Items in production, as of now">
              {data.sites.length === 0 ? <ChartEmpty hint="No items are in production at any site." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.sites} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="site" tick={AXIS} axisLine={false} tickLine={false} interval={0} angle={data.sites.length > 6 ? -35 : 0} textAnchor={data.sites.length > 6 ? 'end' : 'middle'} height={data.sites.length > 6 ? 48 : 28} />
                      <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={30} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [num(Number(v)), 'Items']} />
                      <Bar dataKey="count" name="Items" fill="#4a6aa8" radius={[4, 4, 0, 0]} maxBarSize={38} label={{ position: 'top', fontSize: 12, fill: '#334155' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="QC pass and rework" subtitle={`QC checks recorded in ${data.label}`}>
              {qc.checks === 0 ? <ChartEmpty hint="No QC checks were recorded in this period." /> : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-emerald-50 px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Pass rate</p>
                      <p className="font-display text-3xl font-bold tabular text-emerald-700">{rate(qc.pass_rate)}</p>
                      <p className="text-xs text-emerald-800">{num(qc.pass)} passed</p>
                    </div>
                    <div className="rounded-lg bg-red-50 px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-red-700">Rework rate</p>
                      <p className="font-display text-3xl font-bold tabular text-red-600">{rate(qc.rework_rate)}</p>
                      <p className="text-xs text-red-700">{num(qc.rework)} sent to rework</p>
                    </div>
                  </div>
                  <div className="relative mt-3 h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={qcData} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
                          {qcData.map((x) => <Cell key={x.name} fill={x.fill} />)}
                        </Pie>
                        <Tooltip formatter={(v, name) => [num(Number(v)), name]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-2xl font-bold tabular text-brand-950">{num(qc.checks)}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">QC checks</span>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>

          <SectionTitle action={data.delayed_count > 0 ? <Pill tone="orange">{num(data.delayed_count)} delayed</Pill> : undefined}>Delayed items</SectionTitle>
          {data.delayed_count > data.delayed.length && (
            <Notice tone="warn" className="mb-3">
              Showing the first {num(data.delayed.length)} of {num(data.delayed_count)} delayed items. Open the <Link to="/monitor" className="font-semibold underline">Live Production Monitor</Link> and choose Delayed to see all of them.
            </Notice>
          )}
          <DataTable<Brief> rows={data.delayed} columns={delayedCols} rowKey={(r) => r.id} exportName="Delayed items" pageSize={10}
            onRowClick={(r) => navigate(`/items/${r.id}`)}
            emptyTitle="No delayed items" emptyHint="Every open item is within its stage time limit and due date." />
        </div>
      )}
    </div>
  )
}
