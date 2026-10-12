// X6 Sales Dashboard (Workflow K): Super Admin only.
import { ChevronDown, Download, FileSpreadsheet, Printer, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, Card, Empty, ErrorNote, PageHeader, PeriodPicker, ProgressBar, SectionTitle, Select, Spinner, StatusBadge, cx, useLoad,
} from '../../components/ui'
import { ApiError, api, qs } from '../../lib/api'
import { exportSheets } from '../../lib/export'
import { compact, compactMoney, currentPeriod, fmtDate, money, num, pct, type Period } from '../../lib/format'

interface Metric { actual: number; target?: number; pct?: number; status?: string; no_target?: boolean }
interface RankRow {
  id: number; name: string; branch?: string; branch_id?: number; designation?: string; rank?: number
  score?: number; status?: string; no_target?: boolean
  sales: Metric; collection: Metric; delivery: Metric; visits: Metric
  leads: number; leads_target?: number; orders: number; orders_target?: number; conversion?: number
  pipeline?: number; open_leads?: number
}
interface BranchRow { id: number; branch: string; sales_admins: number; sales: Metric; collection: Metric; delivery: Metric; visits: Metric }
interface LeadRow { id: number; lead_no: string; lead_date?: string; customer_name?: string; sales_admin?: string; branch?: string; expected_value?: number; stage?: string; status?: string }
interface Dashboard {
  label: string
  summary: {
    sales: Metric; collection: Metric; delivery: Metric; visits: Metric; leads: Metric; orders: Metric
    conversion: { pct?: number; status?: string; no_leads?: boolean }
    pipeline: { value: number; open_leads: number }
  }
  ranking: RankRow[]
  branches: BranchRow[]
  trend: { label: string; actual: number; target: number; collection: number; delivery: number }[]
  funnel: LeadRow[]
  stage_counts: { stage: string; count: number }[]
  formula: string
  thresholds: { on_track: number; watch: number }
  sales_admins: { id: number; name: string; branch_id?: number }[]
}
interface Meta { branches: { id: number; name: string; active?: boolean }[] }

const RANK_OPTIONS = [
  ['score', 'Overall Score'], ['sales', 'Sales Achievement'], ['collection', 'Collection Achievement'],
  ['delivery', 'Delivery Achievement'], ['visits', 'Client Visits'],
] as const

const STATUS_TEXT: Record<string, string> = { 'On Track': 'text-emerald-700', Watch: 'text-amber-700', Critical: 'text-red-600' }
const statusText = (s?: string) => (s ? STATUS_TEXT[s] ?? 'text-brand-950' : 'text-brand-950')
const statusBar = (s?: string) => (s === 'On Track' ? 'green' : s === 'Watch' ? 'amber' : s === 'Critical' ? 'red' : 'slate') as 'green' | 'amber' | 'red' | 'slate'

type Fmt = (v: number | null | undefined) => string
const count: Fmt = (v) => num(v)
/** "actual / target": always actual first, then target. */
const pair = (m: Metric | undefined, f: Fmt) => (!m ? '' : m.target ? `${f(m.actual)} / ${f(m.target)}` : f(m.actual))
const plainPair = (m: Metric | undefined) => (!m ? '' : m.target ? `${Math.round(m.actual)} / ${Math.round(m.target)}` : `${Math.round(m.actual)}`)

function MetricCard({ label, m, f, caption }: { label: string; m: Metric; f: Fmt; caption: string }) {
  const none = !!m.no_target || m.pct === undefined || m.pct === null
  return (
    <div className="print-break-avoid flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {!none && <StatusBadge status={m.status} />}
      </div>
      <p className={cx('mt-2 font-display text-xl font-bold tabular leading-tight sm:text-[22px]', none ? 'text-brand-950' : statusText(m.status))}>
        {f(m.actual)}
        {!none && <span className="text-sm font-semibold text-slate-400"> / {f(m.target)}</span>}
      </p>
      {none ? <p className="mt-1 text-xs font-medium text-slate-500">No target</p> : (
        <>
          <p className="mt-1 text-xs text-slate-500">{pct(m.pct)} {caption}</p>
          <ProgressBar value={m.pct} tone={statusBar(m.status)} className="mt-3" />
        </>
      )}
    </div>
  )
}

function SimpleCard({ label, value, hint, status, bar, tone }: { label: string; value: ReactNode; hint: ReactNode; status?: string; bar?: number; tone?: string }) {
  return (
    <div className="print-break-avoid flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <StatusBadge status={status} />
      </div>
      <p className={cx('mt-2 font-display text-xl font-bold tabular leading-tight sm:text-[22px]', tone ?? 'text-brand-950')}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      {bar !== undefined && <ProgressBar value={bar} tone={statusBar(status)} className="mt-3" />}
    </div>
  )
}

function Tile({ label, m, f }: { label: string; m: Metric; f: Fmt }) {
  const none = !!m.no_target || m.pct === undefined || m.pct === null
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-display text-lg font-bold tabular text-brand-950">{pair(m, f)}</p>
      {none ? <p className="mt-1 text-xs text-slate-500">No target</p> : (
        <>
          <p className={cx('mt-1 text-xs font-semibold', statusText(m.status))}>Achievement {pct(m.pct)}</p>
          <ProgressBar value={m.pct} tone={statusBar(m.status)} className="mt-2" />
        </>
      )}
    </div>
  )
}

function ExportMenu({ onExcel, disabled }: { onExcel: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = 'flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-brand-50'
  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Export <ChevronDown className="h-4 w-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop">
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onExcel() }}><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); setTimeout(() => window.print(), 50) }}><Printer className="h-4 w-4 text-brand-600" /> PDF</button>
        </div>
      )}
    </div>
  )
}

const axisTick = { fontSize: 11, fill: '#64748b' }

export default function SalesPerformance() {
  const [period, setPeriod] = useState<Period>(() => currentPeriod('monthly'))
  const [branchId, setBranchId] = useState(0)
  const [adminId, setAdminId] = useState(0)
  const [rankBy, setRankBy] = useState<string>('score')
  const [selected, setSelected] = useState<number | null>(null)

  const meta = useLoad<Meta>(() => api.get('/meta'), [])
  const { data, loading, error } = useLoad<Dashboard>(
    () => api.get<Dashboard>(`/sales/dashboard${qs({ mode: period.mode, year: period.year, period: period.period, branch_id: branchId, sales_admin_id: adminId, rank_by: rankBy })}`)
      .catch((e) => { throw e instanceof ApiError && e.status === 403 ? new Error('You do not have access to the Sales Dashboard.') : e }),
    [period.mode, period.year, period.period, branchId, adminId, rankBy],
  )

  const admins = useMemo(() => (data?.sales_admins ?? []).filter((a) => !branchId || a.branch_id === branchId), [data, branchId])
  const ranking = data?.ranking ?? []
  const detail = ranking.find((r) => r.id === (adminId || selected)) ?? null
  const onTrack = data?.thresholds?.on_track ?? 75

  const branchChart = useMemo(() => (data?.branches ?? []).map((b) => ({
    branch: b.branch, Sales: b.sales.pct ?? 0, Collection: b.collection.pct ?? 0, Delivery: b.delivery.pct ?? 0,
  })), [data])
  const stages = useMemo(() => (data?.stage_counts ?? []).filter((s) => s.count > 0), [data])

  const metricCols = (key: 'sales' | 'collection' | 'delivery' | 'visits', label: string, f: Fmt): Column<RankRow>[] => [
    { key: `${key}_at`, header: `${label} Actual / Target`, align: 'right', value: (r) => (key === 'visits' ? plainPair(r[key]) : pair(r[key], f)), sortable: false },
    {
      key: `${key}_pct`, header: key === 'visits' ? 'Visit %' : `${label} %`, align: 'right', value: (r) => r[key].pct,
      render: (r) => (r[key].pct === undefined ? <span className="text-xs text-slate-400">No target</span> : <span className={cx('font-semibold', statusText(r[key].status))}>{pct(r[key].pct)}</span>),
    },
  ]
  const rankCols: Column<RankRow>[] = [
    { key: 'rank', header: 'Rank', render: (r) => <span className="font-display font-bold text-gold-600">{r.rank}</span> },
    { key: 'name', header: 'Sales Admin', render: (r) => <span className="font-semibold text-brand-950">{r.name}</span> },
    { key: 'branch', header: 'Branch' },
    ...metricCols('sales', 'Sales', compactMoney),
    ...metricCols('collection', 'Collection', compactMoney),
    ...metricCols('delivery', 'Delivery', compactMoney),
    ...metricCols('visits', 'Visits', count),
    { key: 'score', header: 'Score', align: 'right', render: (r) => (r.score === undefined ? null : <span className={cx('font-bold', statusText(r.status))}>{pct(r.score)}</span>) },
    { key: 'status', header: 'Status', render: (r) => (r.status ? <StatusBadge status={r.status} /> : <span className="text-xs text-slate-400">No target</span>), value: (r) => r.status ?? 'No target' },
  ]
  const funnelCols: Column<LeadRow>[] = [
    { key: 'lead_no', header: 'Lead ID', render: (r) => <span className="font-semibold text-brand-800">{r.lead_no}</span> },
    { key: 'lead_date', header: 'Date', render: (r) => (r.lead_date ? fmtDate(r.lead_date) : null) },
    { key: 'customer_name', header: 'Customer' },
    { key: 'sales_admin', header: 'Sales Admin' },
    { key: 'branch', header: 'Branch' },
    { key: 'expected_value', header: 'Value', align: 'right', render: (r) => (r.expected_value ? money(r.expected_value) : null) },
    { key: 'stage', header: 'Stage' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ]

  const exportExcel = () => {
    if (!data) return
    const mrow = (label: string, m: Metric) => ({ [`${label} Actual`]: m.actual, [`${label} Target`]: m.target ?? '', [`${label} %`]: m.pct ?? '' })
    exportSheets(`Sales Dashboard ${data.label}`, [
      { name: 'Ranking', rows: data.ranking.map((r) => ({
        Rank: r.rank ?? '', 'Sales Admin': r.name, Branch: r.branch ?? '', ...mrow('Sales', r.sales), ...mrow('Collection', r.collection),
        ...mrow('Delivery', r.delivery), ...mrow('Visits', r.visits), Leads: r.leads, Orders: r.orders, 'Conversion %': r.conversion ?? '',
        'Open Pipeline': r.pipeline ?? '', 'Score %': r.score ?? '', Status: r.status ?? 'No target',
      })) },
      { name: 'Branches', rows: data.branches.map((b) => ({ Branch: b.branch, 'Sales Admins': b.sales_admins, ...mrow('Sales', b.sales), ...mrow('Collection', b.collection), ...mrow('Delivery', b.delivery), ...mrow('Visits', b.visits) })) },
      { name: 'Trend', rows: data.trend.map((t) => ({ Month: t.label, 'Sales Actual': t.actual, 'Sales Target': t.target, 'Collection Actual': t.collection, 'Delivery Actual': t.delivery })) },
      { name: 'Sales Funnel', rows: data.funnel.map((l) => ({ 'Lead ID': l.lead_no, Date: l.lead_date ? fmtDate(l.lead_date) : '', Customer: l.customer_name ?? '', 'Sales Admin': l.sales_admin ?? '', Branch: l.branch ?? '', Value: l.expected_value ?? '', Stage: l.stage ?? '', Status: l.status ?? '' })) },
    ])
  }

  const s = data?.summary

  return (
    <div>
      <PageHeader title="Sales Dashboard" subtitle={data ? `Performance for ${data.label}` : 'Sales, collection, delivery and client visits against target'} />

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-card no-print">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="w-full sm:w-44">
          <Select aria-label="Branch" value={branchId} onChange={(e) => { setBranchId(+e.target.value); setAdminId(0); setSelected(null) }}>
            <option value={0}>All branches</option>
            {(meta.data?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label="Sales Admin" value={adminId} onChange={(e) => { setAdminId(+e.target.value); setSelected(null) }}>
            <option value={0}>All Sales Admins</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-52">
          <Select aria-label="Rank by" value={rankBy} onChange={(e) => setRankBy(e.target.value)}>
            {RANK_OPTIONS.map(([v, l]) => <option key={v} value={v}>Rank by: {l}</option>)}
          </Select>
        </div>
        <div className="ml-auto"><ExportMenu onExcel={exportExcel} disabled={!data} /></div>
      </div>

      {error ? <ErrorNote error={error} /> : !data || !s ? <Spinner /> : (
        <div className={cx('print-area transition-opacity', loading && 'opacity-60')}>
          <div className="mb-4 hidden print:block">
            <h1 className="text-xl font-bold text-brand-950">Sales Dashboard</h1>
            <p className="text-sm text-slate-600">{data.label}</p>
          </div>

          {/* summary cards */}
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Client Visits" m={s.visits} f={count} caption="of target" />
            <MetricCard label="Leads" m={s.leads} f={count} caption="of target" />
            <MetricCard label="Orders" m={s.orders} f={count} caption="of target" />
            {s.conversion.no_leads || s.conversion.pct === undefined
              ? <SimpleCard label="Conversion" value="No leads" hint="Lead to order" />
              : <SimpleCard label="Conversion" value={pct(s.conversion.pct)} hint="Lead to order" status={s.conversion.status} bar={s.conversion.pct} tone={statusText(s.conversion.status)} />}
            <SimpleCard label="Open Pipeline" value={compactMoney(s.pipeline.value)} hint={`${num(s.pipeline.open_leads)} open leads`} />
            <MetricCard label="Sales" m={s.sales} f={compactMoney} caption="achievement" />
            <MetricCard label="Collection" m={s.collection} f={compactMoney} caption="achievement" />
            <MetricCard label="Delivery" m={s.delivery} f={compactMoney} caption="achievement" />
          </div>

          {/* charts */}
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Branch-wise achievement (%)" subtitle={`Dashed line: On Track at ${onTrack}%`} className="print-break-avoid">
              {!branchChart.length ? <Empty title="No branch data for this period" /> : (
                <>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={branchChart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="branch" tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v: any) => `${Math.round(Number(v))}%`} cursor={{ fill: '#f2f5fb' }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <ReferenceLine y={onTrack} stroke="#059669" strokeDasharray="5 4" />
                        <Bar dataKey="Sales" fill="#22355c" radius={[3, 3, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="Collection" fill="#4a6aa8" radius={[3, 3, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="Delivery" fill="#d4a63d" radius={[3, 3, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-max text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="py-2 pr-3">Branch</th><th className="px-3 py-2 text-right">Sales Admins</th>
                          <th className="px-3 py-2 text-right">Sales A / T</th><th className="px-3 py-2 text-right">Collection A / T</th><th className="py-2 pl-3 text-right">Delivery A / T</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.branches.map((b) => (
                          <tr key={b.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 pr-3 font-semibold text-brand-950">{b.branch}</td>
                            <td className="px-3 py-2 text-right tabular">{b.sales_admins}</td>
                            {([b.sales, b.collection, b.delivery] as Metric[]).map((m, i) => (
                              <td key={i} className={cx('py-2 text-right tabular', i === 2 ? 'pl-3' : 'px-3')}>
                                {pair(m, compact)}
                                <span className={cx('ml-1.5 font-semibold', m.pct === undefined ? 'text-slate-400' : statusText(m.status))}>{m.pct === undefined ? 'No target' : pct(m.pct)}</span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>

            <Card title="Monthly trend: sales actual vs target" className="print-break-avoid">
              {!data.trend.some((t) => t.actual || t.target) ? <Empty title="No sales recorded in these months" /> : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => compact(Number(v))} />
                      <Tooltip formatter={(v: any) => compactMoney(Number(v))} cursor={{ fill: '#f2f5fb' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="actual" name="Sales actual" fill="#22355c" radius={[3, 3, 0, 0]} maxBarSize={40} />
                      <Line dataKey="target" name="Sales target" stroke="#d4a63d" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: '#d4a63d' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          {/* ranking */}
          <SectionTitle>Salesperson Performance &amp; Ranking</SectionTitle>
          {!ranking.length ? <Card><Empty title="No Sales Admin activity for this period" hint="Try another period or branch." /></Card> : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {ranking.map((r) => {
                  const active = detail?.id === r.id
                  return (
                    <button key={r.id} type="button" onClick={() => setSelected(active && !adminId ? null : r.id)} aria-pressed={active}
                      className={cx('print-break-avoid flex items-center gap-3 rounded-xl border bg-white p-3.5 text-left shadow-card transition hover:border-brand-400 hover:shadow-md', active ? 'border-brand-600 ring-2 ring-brand-200' : 'border-slate-200')}>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-50 font-display text-lg font-bold text-gold-600">{r.rank}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-brand-950">{r.name}</span>
                        <span className="block truncate text-xs text-slate-500">{[r.branch, r.designation || 'Sales Admin'].filter(Boolean).join(' · ')}</span>
                        {r.score === undefined ? <span className="mt-1.5 block text-xs text-slate-500">No target</span>
                          : <ProgressBar value={r.score} tone={statusBar(r.status)} className="mt-2" />}
                      </span>
                      {r.score !== undefined && <span className={cx('font-display text-xl font-bold tabular', statusText(r.status))}>{pct(r.score)}</span>}
                    </button>
                  )
                })}
              </div>

              {detail && (
                <Card className="print-break-avoid mt-4 border-brand-200" padded={false}>
                  <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold-50 font-display text-xl font-bold text-gold-600">{detail.rank}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-bold text-brand-950">{detail.name}</h3>
                      <p className="text-xs text-slate-500">
                        {[detail.branch, detail.designation || 'Sales Admin', detail.score !== undefined ? `Overall score ${pct(detail.score)}` : 'No target'].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <StatusBadge status={detail.status} />
                    {!adminId && <Button variant="secondary" size="sm" className="no-print" icon={<X className="h-4 w-4" />} onClick={() => setSelected(null)}>Close</Button>}
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
                      <Tile label="Sales" m={detail.sales} f={compactMoney} />
                      <Tile label="Collection" m={detail.collection} f={compactMoney} />
                      <Tile label="Delivery" m={detail.delivery} f={compactMoney} />
                      <Tile label="Client Visits" m={detail.visits} f={count} />
                    </div>
                    <p className="mt-4 text-[13px] text-slate-600">
                      Leads <b className="text-brand-950">{num(detail.leads)}</b> · Orders <b className="text-brand-950">{num(detail.orders)}</b> · Conversion{' '}
                      <b className="text-brand-950">{detail.conversion === undefined ? 'No leads' : pct(detail.conversion)}</b> · Ranking formula: {data.formula}
                    </p>
                  </div>
                </Card>
              )}

              <div className="mt-4">
                <DataTable rows={ranking} columns={rankCols} rowKey={(r) => r.id} exportName={`Sales Ranking ${data.label}`} searchPlaceholder="Search Sales Admin or branch…"
                  onRowClick={(r) => setSelected(r.id)} rowClassName={(r) => (detail?.id === r.id ? 'bg-brand-50/70' : undefined)} />
              </div>
            </>
          )}

          {/* funnel */}
          <SectionTitle>Sales Funnel</SectionTitle>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <DataTable rows={data.funnel} columns={funnelCols} rowKey={(r) => r.id} exportName={`Sales Funnel ${data.label}`} pageSize={10}
                emptyTitle="No leads in this period" searchPlaceholder="Search leads…" />
            </div>
            <Card title="Leads by stage" className="print-break-avoid">
              {!stages.length ? <Empty title="No leads in this period" /> : (
                <div className="w-full" style={{ height: Math.max(180, stages.length * 42 + 30) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stages} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="stage" width={128} tick={axisTick} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                      <Tooltip formatter={(v: any) => [num(Number(v)), 'Leads']} cursor={{ fill: '#f2f5fb' }} />
                      <Bar dataKey="count" name="Leads" radius={[0, 3, 3, 0]} maxBarSize={22}>
                        {stages.map((st) => <Cell key={st.stage} fill={st.stage === 'Won' ? '#059669' : st.stage === 'Lost' ? '#dc2626' : '#4a6aa8'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <p className="mt-6 text-xs text-slate-500">
            Rows with no data are hidden. Values follow the organisation's number format. Only the Super Admin can open this screen.
          </p>
        </div>
      )}
    </div>
  )
}
