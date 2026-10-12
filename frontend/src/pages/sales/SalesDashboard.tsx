// S1 Sales Admin dashboard: own-branch orders for a period, plus the signed-in Sales Admin's own targets.
import { Banknote, CheckCircle2, ClipboardList, Factory, Hourglass, Plus, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, Empty, ErrorNote, Notice, PageHeader, PeriodPicker, SectionTitle, Spinner, StatCard, useLoad } from '../../components/ui'
import { api, qs } from '../../lib/api'
import { compact, compactMoney, currentPeriod, money, num, type Period } from '../../lib/format'
import { MyTargets, type MySummary } from './SalesRecord'

interface Dashboard {
  label?: string
  branch?: string
  drafts?: number
  returned?: number
  cards: { total_orders: number; total_amount: number; pending: number; in_production: number; completed: number; delivered: number }
  status: { status: string; count: number }[]
  series: { label: string; orders: number; amount: number }[]
}

const STATUS_COLOUR: Record<string, string> = {
  Pending: '#94a3b8', Returned: '#dc2626', 'In Production': '#52525b', Completed: '#d4a63d',
  'Partly Delivered': '#0d9488', Delivered: '#059669', Cancelled: '#f3adab',
}
const FALLBACK = ['#d83533', '#52525b', '#f3adab', '#d4a63d', '#059669', '#0d9488', '#dc2626', '#94a3b8']
const AXIS = { fontSize: 12, fill: '#64748b' }
const TIP = { borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, boxShadow: '0 8px 24px rgba(15,23,42,.12)' }

export default function SalesDashboard() {
  const nav = useNavigate()
  const [period, setPeriod] = useState<Period>(currentPeriod())
  const query = qs({ mode: period.mode, year: period.year, period: period.period })
  const dash = useLoad<Dashboard>(() => api.get(`/dashboard/sales-admin${query}`), [query])
  const mine = useLoad<MySummary>(() => api.get(`/sales/summary${query}`), [query])

  const d = dash.data
  const go = (status?: string) => nav(`/sales/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`)
  const series = d?.series ?? []
  const hasSeries = series.some((s) => s.orders > 0 || s.amount > 0)
  const statuses = (d?.status ?? []).filter((s) => s.count > 0)
  const statusTotal = statuses.reduce((t, s) => t + s.count, 0)
  const colourOf = (status: string, i: number) => STATUS_COLOUR[status] ?? FALLBACK[i % FALLBACK.length]
  const chartNote = period.mode === 'monthly' ? 'Last six months' : 'By month'

  return (
    <div>
      <PageHeader title="Sales Dashboard"
        subtitle={[d?.branch, d?.label].filter(Boolean).join(' · ') || 'Orders of your branch'}
        actions={<>
          <PeriodPicker value={period} onChange={setPeriod} />
          <Link to="/sales/orders/new"><Button icon={<Plus className="h-4 w-4" />}>New Order</Button></Link>
        </>} />

      {dash.error ? <ErrorNote error={dash.error} /> : dash.loading && !d ? <Spinner /> : d && (
        <>
          {(!!d.returned || !!d.drafts) && (
            <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              {!!d.returned && (
                <Notice tone="warn">
                  {d.returned} {d.returned === 1 ? 'order was' : 'orders were'} returned by the Production Manager and {d.returned === 1 ? 'needs' : 'need'} correction.{' '}
                  <Link to="/sales/orders?status=Returned" className="font-semibold underline">Review returned orders</Link>
                </Notice>
              )}
              {!!d.drafts && (
                <Notice>
                  You have {d.drafts} draft {d.drafts === 1 ? 'order' : 'orders'} that {d.drafts === 1 ? 'has' : 'have'} not been placed.{' '}
                  <Link to="/sales/orders?status=Draft" className="font-semibold underline">Open drafts</Link>
                </Notice>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard label="Total Orders" value={num(d.cards.total_orders)} icon={<ClipboardList className="h-5 w-5" />} tone="brand" onClick={() => go()} />
            <StatCard label="Total Order Amount" value={compactMoney(d.cards.total_amount)} hint={money(d.cards.total_amount)} icon={<Banknote className="h-5 w-5" />} tone="gold" onClick={() => go()} />
            <StatCard label="Pending" value={num(d.cards.pending)} icon={<Hourglass className="h-5 w-5" />} tone="slate" onClick={() => go('Pending,Returned')} />
            <StatCard label="In Production" value={num(d.cards.in_production)} icon={<Factory className="h-5 w-5" />} tone="brand" onClick={() => go('In Production')} />
            <StatCard label="Completed" value={num(d.cards.completed)} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" onClick={() => go('Completed')} />
            <StatCard label="Delivered" value={num(d.cards.delivered)} icon={<Truck className="h-5 w-5" />} tone="teal" onClick={() => go('Delivered,Partly Delivered')} />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            <Card title="Orders by period" subtitle={chartNote}>
              {!hasSeries ? <Empty title="No orders in these months" hint="Placed orders will appear here." /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                      <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={TIP} formatter={(v) => [num(Number(v)), 'Orders']} />
                      <Bar dataKey="orders" name="Orders" fill="#d83533" radius={[4, 4, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Order amount by period" subtitle={chartNote}>
              {!hasSeries ? <Empty title="No order amount in these months" hint="Placed orders will appear here." /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => compact(Number(v))} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={TIP} formatter={(v) => [compactMoney(Number(v)), 'Order amount']} />
                      <Bar dataKey="amount" name="Order amount" fill="#d4a63d" radius={[4, 4, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Order status distribution" subtitle={d.label} className="lg:col-span-2 2xl:col-span-1">
              {!statusTotal ? <Empty title="No orders in this period" hint="Choose another period or place a new order." /> : (
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <div className="relative h-56 w-full max-w-[240px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statuses} dataKey="count" nameKey="status" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
                          {statuses.map((s, i) => <Cell key={s.status} fill={colourOf(s.status, i)} />)}
                        </Pie>
                        <Tooltip contentStyle={TIP} formatter={(v, name) => [num(Number(v)), String(name)]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-2xl font-bold tabular text-brand-950">{num(statusTotal)}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Orders</span>
                    </div>
                  </div>
                  <ul className="w-full min-w-0 space-y-1">
                    {statuses.map((s, i) => (
                      <li key={s.status}>
                        <button type="button" onClick={() => go(s.status)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-brand-50">
                          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: colourOf(s.status, i) }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{s.status}</span>
                          <span className="font-bold tabular text-brand-950">{num(s.count)}</span>
                          <span className="w-10 text-right text-xs tabular text-slate-500">{Math.round((s.count / statusTotal) * 100)}%</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <SectionTitle action={<Link to="/sales/record" className="text-[13px] font-semibold text-brand-700 hover:underline">Open Sales Record</Link>}>
        My sales this period
      </SectionTitle>
      {mine.error ? <ErrorNote error={mine.error} /> : mine.loading && !mine.data ? <Spinner /> : <MyTargets summary={mine.data} />}
    </div>
  )
}
