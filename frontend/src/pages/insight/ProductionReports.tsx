// X7 Production Reports: list of current reports and the summary view (FR-PR-08).
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, Empty, ErrorNote, Input, PageHeader, Select, Spinner, StatCard, StatusBadge, Tabs, useLoad } from '../../components/ui'
import { api } from '../../lib/api'
import { MONTH_NAMES, compact, currentSettings, fmtDate, money, num } from '../../lib/format'

interface ReportRow {
  id: number; report_no: string; revision: number; status: string; generated_at?: string; item_id: number; order_no?: string; item_no?: string
  customer?: string; product_name?: string; product_code?: string; category?: string; site?: string; apm?: string; branch?: string
  delivery_date?: string; lead_time_days?: number; rework_count?: number; total_cost?: number
}
interface Agg { reports: number; avg_lead_days: number; rework_rate: number; avg_cost?: number }
interface Summary { categories: (Agg & { category: string })[]; months: (Agg & { month: string })[]; show_cost: boolean }
type Grouping = 'month' | 'quarter' | 'year'
type PeriodAgg = Agg & { key: string; label: string }

const axisTick = { fontSize: 11, fill: '#64748b' }
const NR = 'Not recorded'
const uniq = (list: (string | undefined)[]) => [...new Set(list.filter((x) => x && x !== NR) as string[])].sort()
const days = (v: number) => `${num(v, v % 1 ? 1 : 0)} d`

function ReportList() {
  const nav = useNavigate()
  const { data, loading, error } = useLoad<ReportRow[]>(() => api.get('/production-reports'), [])
  const [f, setF] = useState({ category: '', site: '', apm: '', status: '', from: '', to: '' })
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  const all = data ?? []
  const rows = useMemo(() => all.filter((r) =>
    (!f.category || r.category === f.category) && (!f.site || r.site === f.site) && (!f.apm || r.apm === f.apm) && (!f.status || r.status === f.status)
    && (!f.from || (!!r.delivery_date && r.delivery_date >= f.from)) && (!f.to || (!!r.delivery_date && r.delivery_date.slice(0, 10) <= f.to))), [all, f])
  const filtered = Object.values(f).some(Boolean)

  const columns: Column<ReportRow>[] = [
    { key: 'report_no', header: 'Report No.', render: (r) => <span className="font-semibold text-brand-800">{r.report_no}</span> },
    { key: 'item_no', header: 'Order / Item No.', value: (r) => r.item_no ?? r.order_no },
    { key: 'customer', header: 'Customer' },
    { key: 'product_name', header: 'Product', value: (r) => [r.product_name, r.product_code].filter(Boolean).join(' · '),
      render: (r) => <span>{r.product_name}{r.product_code && <span className="ml-1.5 text-xs text-slate-500">{r.product_code}</span>}</span> },
    { key: 'category', header: 'Category' },
    { key: 'site', header: 'Site', render: (r) => (r.site === NR ? <span className="italic text-orange-600">{NR}</span> : r.site) },
    { key: 'apm', header: 'APM', render: (r) => (r.apm === NR ? <span className="italic text-orange-600">{NR}</span> : r.apm) },
    { key: 'delivery_date', header: 'Delivery Date', render: (r) => (r.delivery_date ? fmtDate(r.delivery_date) : null) },
    { key: 'lead_time_days', header: 'Lead time (days)', align: 'right' },
    { key: 'rework_count', header: 'Rework', align: 'right', render: (r) => (r.rework_count ? <span className="font-semibold text-red-600">{r.rework_count}</span> : null) },
    { key: 'total_cost', header: 'Total cost', align: 'right', render: (r) => (r.total_cost === undefined || r.total_cost === null ? null : money(r.total_cost, 2)) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ]

  if (error) return <ErrorNote error={error} />
  if (loading && !data) return <Spinner />
  const sel = (k: 'category' | 'site' | 'apm', label: string, plural: string) => (
    <div className="w-full min-[420px]:w-40"><Select aria-label={label} className="!h-9" value={f[k]} onChange={(e) => set(k, e.target.value)}>
      <option value="">All {plural}</option>{uniq(all.map((r) => r[k])).map((s) => <option key={s}>{s}</option>)}
    </Select></div>
  )
  return (
    <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => nav(`/reports/${r.id}`)} exportName="Production Reports"
      searchPlaceholder="Search report, order, customer…" emptyTitle="No Production Reports found"
      emptyHint={filtered ? 'Try clearing the filters.' : 'A report is generated automatically when an item is delivered.'}
      filters={<>
        {sel('category', 'Category', 'categories')}
        {sel('site', 'Site', 'sites')}
        {sel('apm', 'APM', 'APMs')}
        <div className="w-full min-[420px]:w-36"><Select aria-label="Status" className="!h-9" value={f.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option><option>Generated</option><option>Revised</option><option>Incomplete</option>
        </Select></div>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">Delivered from
          <Input type="date" aria-label="Delivered from" className="!h-9 w-36" value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">to
          <Input type="date" aria-label="Delivered to" className="!h-9 w-36" value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} /></label>
        {filtered && <Button variant="ghost" size="sm" onClick={() => setF({ category: '', site: '', apm: '', status: '', from: '', to: '' })}>Clear</Button>}
      </>} />
  )
}

/** Combine monthly rows into months, quarters or years, weighted by the number of reports. */
function groupMonths(months: Summary['months'], grouping: Grouping): PeriodAgg[] {
  const fy = currentSettings().fiscal_year_start || 1
  const acc = new Map<string, { label: string; reports: number; lead: number; rework: number; cost: number; hasCost: boolean }>()
  months.forEach((m) => {
    const y = +m.month.slice(0, 4), mo = +m.month.slice(5, 7)
    const fyYear = mo >= fy ? y : y - 1
    const fyLabel = fy === 1 ? `${fyYear}` : `FY ${fyYear}-${String(fyYear + 1).slice(2)}`
    let key = m.month, label = `${MONTH_NAMES[mo - 1] ?? ''} ${y}`
    if (grouping === 'quarter') { const q = Math.floor(((mo - fy + 12) % 12) / 3) + 1; key = `${fyYear}-Q${q}`; label = `Q${q} ${fyLabel}` }
    if (grouping === 'year') { key = `${fyYear}`; label = fyLabel }
    const a = acc.get(key) ?? { label, reports: 0, lead: 0, rework: 0, cost: 0, hasCost: false }
    a.reports += m.reports
    a.lead += m.avg_lead_days * m.reports
    a.rework += m.rework_rate * m.reports
    if (m.avg_cost !== undefined && m.avg_cost !== null) { a.cost += m.avg_cost * m.reports; a.hasCost = true }
    acc.set(key, a)
  })
  return [...acc.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, a]) => ({
    key, label: a.label, reports: a.reports, avg_lead_days: a.reports ? Math.round(a.lead / a.reports * 10) / 10 : 0,
    rework_rate: a.reports ? Math.round(a.rework / a.reports * 10) / 10 : 0,
    avg_cost: a.hasCost && a.reports ? Math.round(a.cost / a.reports * 100) / 100 : undefined,
  }))
}

function SummaryView() {
  const { data, error } = useLoad<Summary>(() => api.get('/production-reports/summary'), [])
  const [grouping, setGrouping] = useState<Grouping>('month')
  const periods = useMemo(() => groupMonths(data?.months ?? [], grouping), [data, grouping])

  if (error) return <ErrorNote error={error} />
  if (!data) return <Spinner />
  if (!data.categories.length) return <Card><Empty title="No Production Reports yet" hint="The summary appears once items have been delivered." /></Card>

  const showCost = data.show_cost
  const total = data.categories.reduce((s, c) => s + c.reports, 0)
  const w = (pick: (c: Agg) => number | undefined) => (total ? data.categories.reduce((s, c) => s + (pick(c) ?? 0) * c.reports, 0) / total : 0)

  const aggCols = <T extends Agg>(first: Column<T>): Column<T>[] => [
    first,
    { key: 'reports', header: 'Reports', align: 'right' },
    { key: 'avg_lead_days', header: 'Average lead time (days)', align: 'right', render: (r) => num(r.avg_lead_days, 1) },
    { key: 'rework_rate', header: 'Rework rate', align: 'right', always: true, render: (r) => <span className={r.rework_rate > 0 ? 'font-semibold text-red-600' : ''}>{num(r.rework_rate, 1)}%</span> },
    ...(showCost ? [{ key: 'avg_cost', header: 'Average recorded cost', align: 'right', render: (r) => (r.avg_cost === undefined ? null : money(r.avg_cost, 2)) } as Column<T>] : []),
  ]
  const groupLabel = grouping === 'month' ? 'Month' : grouping === 'quarter' ? 'Quarter' : 'Year'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Reports" value={num(total)} hint="Current revisions" />
        <StatCard label="Average lead time" value={days(Math.round(w((c) => c.avg_lead_days) * 10) / 10)} hint="Order placed to delivered" />
        <StatCard label="Rework rate" value={`${num(w((c) => c.rework_rate), 1)}%`} hint="Items with at least one rework" />
        {showCost && <StatCard label="Average recorded cost" value={money(w((c) => c.avg_cost))} hint="Per delivered item" />}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Average lead time by category (days)" className="print-break-avoid">
          <div className="w-full" style={{ height: Math.max(240, data.categories.length * 36 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.categories} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="category" width={120} tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <Tooltip formatter={(v: any) => [days(Number(v)), 'Average lead time']} cursor={{ fill: '#f2f5fb' }} />
                <Bar dataKey="avg_lead_days" fill="#22355c" radius={[0, 3, 3, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Rework rate by category (%)" className="print-break-avoid">
          <div className="w-full" style={{ height: Math.max(240, data.categories.length * 36 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.categories} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="category" width={120} tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <Tooltip formatter={(v: any) => [`${num(Number(v), 1)}%`, 'Rework rate']} cursor={{ fill: '#f2f5fb' }} />
                <Bar dataKey="rework_rate" fill="#dc2626" radius={[0, 3, 3, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title={`Trend by ${groupLabel.toLowerCase()}`} subtitle="Average lead time, rework rate and average recorded cost" className="print-break-avoid"
        actions={<Tabs<Grouping> value={grouping} onChange={setGrouping} className="no-print" options={[{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />}>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={periods} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis yAxisId="l" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={axisTick} tickLine={false} axisLine={false} width={showCost ? 60 : 0} hide={!showCost} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip cursor={{ fill: '#f2f5fb' }} formatter={(v: any, name: any) => (name === 'Average recorded cost' ? money(Number(v), 2) : name === 'Rework rate (%)' ? `${num(Number(v), 1)}%` : days(Number(v)))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="avg_lead_days" name="Average lead time (days)" fill="#4a6aa8" radius={[3, 3, 0, 0]} maxBarSize={40} />
              <Line yAxisId="l" dataKey="rework_rate" name="Rework rate (%)" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
              {showCost && <Line yAxisId="r" dataKey="avg_cost" name="Average recorded cost" stroke="#d4a63d" strokeWidth={2} dot={{ r: 3 }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-[15px] font-bold text-brand-950">By product category</h2>
        <DataTable rows={data.categories} rowKey={(r) => r.category} searchable={false} exportName="Production Report Summary by Category"
          columns={aggCols<Summary['categories'][number]>({ key: 'category', header: 'Category', render: (r) => <span className="font-semibold text-brand-950">{r.category}</span> })} />
      </div>
      <div>
        <h2 className="mb-2 text-[15px] font-bold text-brand-950">By {groupLabel.toLowerCase()}</h2>
        <DataTable rows={periods} rowKey={(r) => r.key} searchable={false} exportName={`Production Report Summary by ${groupLabel}`}
          columns={aggCols<PeriodAgg>({ key: 'label', header: groupLabel, sortable: false, render: (r) => <span className="font-semibold text-brand-950">{r.label}</span> })} />
      </div>
    </div>
  )
}

export default function ProductionReports() {
  const [tab, setTab] = useState<'reports' | 'summary'>('reports')
  return (
    <div>
      <PageHeader title="Production Reports" subtitle="Generated automatically when an item is delivered" />
      <Tabs value={tab} onChange={setTab} className="mb-4 no-print" options={[{ value: 'reports', label: 'Reports' }, { value: 'summary', label: 'Summary' }]} />
      {tab === 'reports' ? <ReportList /> : <SummaryView />}
    </div>
  )
}
