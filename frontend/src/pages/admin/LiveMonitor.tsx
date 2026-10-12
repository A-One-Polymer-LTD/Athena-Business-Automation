// X1 Live Production Monitor: every open item across production and warehouse, refreshed every 60 seconds.
import { AlertTriangle, ClipboardCheck, Factory, Layers, RefreshCw, RotateCcw, Search, Warehouse, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Pill, Select, Spinner, StatCard, StatusBadge, useLoad } from '../../components/ui'
import { api, qs } from '../../lib/api'
import { fmtDate, num } from '../../lib/format'

interface Item {
  id: number
  item_no: string
  customer: string
  product_code?: string
  product_name?: string
  category?: string
  stage: string
  status: string
  days_in_stage?: number
  delayed?: boolean
  rework?: boolean
  rework_count?: number
  site_id?: number
  site?: string
  site_name?: string
  apm?: string
  apm_id?: number
  promised_date?: string
  order_date?: string
}
interface Meta {
  sites: { id: number; code: string; name: string; active: boolean }[]
  production_stages: string[]
  masters: Record<string, { code: string; name: string }[]>
}
interface Apm { id: number; name: string; active: boolean }

const WAREHOUSE_STAGES = ['In Warehouse', 'Packed', 'Ready for Delivery']
const REFRESH_SECONDS = 60

type Bucket = 'all' | 'production' | 'qc' | 'rework' | 'delayed' | 'warehouse'
const isWarehouse = (r: Item) => WAREHOUSE_STAGES.includes(r.stage)
const hasRework = (r: Item) => !!r.rework || (r.rework_count ?? 0) > 0
const BUCKETS: Record<Bucket, (r: Item) => boolean> = {
  all: () => true,
  production: (r) => !isWarehouse(r),
  qc: (r) => r.status === 'At QC',
  rework: hasRework,
  delayed: (r) => !!r.delayed,
  warehouse: isWarehouse,
}
const BUCKET_LABEL: Record<Bucket, string> = {
  all: 'Open items', production: 'In production', qc: 'At QC', rework: 'Rework', delayed: 'Delayed', warehouse: 'In warehouse / ready',
}

const EMPTY_FILTERS = { site_id: '', apm_id: '', stage: '', category: '', date_from: '', date_to: '' }

export default function LiveMonitor() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [bucket, setBucket] = useState<Bucket>('all')
  const [updated, setUpdated] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const meta = useLoad<Meta>(() => api.get('/meta'))
  const apms = useLoad<Apm[]>(() => api.get('/apms'))

  const badDates = !!filters.date_from && !!filters.date_to && filters.date_from > filters.date_to
  const query = qs({ scope: 'open', ...filters, site_id: +filters.site_id || undefined, apm_id: +filters.apm_id || undefined })
  const items = useLoad<Item[]>(
    () => api.get<Item[]>(`/items${query}`).then((d) => { setUpdated(new Date()); return d }).finally(() => setRefreshing(false)),
    [query],
  )

  // silent refresh every 60 seconds
  const reloadRef = useRef(items.reload)
  reloadRef.current = items.reload
  useEffect(() => {
    const t = setInterval(() => reloadRef.current(), REFRESH_SECONDS * 1000)
    return () => clearInterval(t)
  }, [])

  const set = (k: keyof typeof EMPTY_FILTERS, v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const anyFilter = Object.values(filters).some(Boolean) || !!search || bucket !== 'all'
  const clear = () => { setFilters(EMPTY_FILTERS); setSearch(''); setBucket('all') }

  // rows after the filter bar and search; the cards and the chart are counted from exactly these rows
  const base = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const all = items.data ?? []
    if (!needle) return all
    return all.filter((r) => [r.item_no, r.customer, r.product_name, r.product_code, r.category, r.site, r.site_name, r.apm, r.stage, r.status]
      .some((v) => String(v ?? '').toLowerCase().includes(needle)))
  }, [items.data, search])

  const counts = useMemo(() => {
    const c = {} as Record<Bucket, number>
    ;(Object.keys(BUCKETS) as Bucket[]).forEach((b) => { c[b] = base.filter(BUCKETS[b]).length })
    return c
  }, [base])
  const reworkNow = useMemo(() => base.filter((r) => r.status === 'Rework').length, [base])
  const rows = useMemo(() => base.filter(BUCKETS[bucket]), [base, bucket])

  const stageOrder = useMemo(() => [...(meta.data?.production_stages ?? []), ...WAREHOUSE_STAGES], [meta.data])
  const perStage = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r) => m.set(r.stage, (m.get(r.stage) ?? 0) + 1))
    const known = stageOrder.filter((s) => m.has(s))
    const other = [...m.keys()].filter((s) => !stageOrder.includes(s))
    return [...known, ...other].map((stage) => ({ stage, count: m.get(stage) ?? 0 }))
  }, [rows, stageOrder])

  const columns: Column<Item>[] = [
    { key: 'item_no', header: 'Item No.', render: (r) => <span className="font-semibold text-brand-800">{r.item_no}</span> },
    { key: 'customer', header: 'Customer' },
    {
      key: 'product_name', header: 'Product',
      value: (r) => (r.product_name && r.product_code ? `${r.product_name} (${r.product_code})` : r.product_name ?? r.product_code),
      render: (r) => (
        <div>
          <div className="font-medium text-brand-950">{r.product_name}</div>
          {r.product_code && <div className="text-xs text-slate-500">{r.product_code}</div>}
        </div>
      ),
    },
    { key: 'category', header: 'Category' },
    { key: 'site', header: 'Site', render: (r) => (r.site ? <span title={r.site_name}>{r.site}</span> : null) },
    { key: 'apm', header: 'APM' },
    { key: 'stage', header: 'Current stage', render: (r) => <StatusBadge status={r.status} />, value: (r) => (r.status !== r.stage ? `${r.stage} (${r.status})` : r.stage) },
    { key: 'days_in_stage', header: 'Days in stage', align: 'right' },
    { key: 'promised_date', header: 'Due date', render: (r) => (r.promised_date ? <span className={r.delayed ? 'font-semibold text-orange-700' : undefined}>{fmtDate(r.promised_date)}</span> : null) },
    {
      key: 'flags', header: 'Flags', sortable: false,
      value: (r) => [r.delayed ? 'Delayed' : '', hasRework(r) ? `Rework${r.rework_count ? ` x${r.rework_count}` : ''}` : ''].filter(Boolean).join(', '),
      render: (r) => (!r.delayed && !hasRework(r) ? null : (
        <div className="flex flex-wrap gap-1">
          {r.delayed && <Pill tone="orange">Delayed</Pill>}
          {hasRework(r) && <Pill tone="red">Rework{r.rework_count ? ` ×${r.rework_count}` : ''}</Pill>}
        </div>
      )),
    },
    { key: 'order_date', header: 'Order date', render: (r) => fmtDate(r.order_date), value: (r) => r.order_date?.slice(0, 10) },
  ]

  const time = updated ? updated.toLocaleTimeString('en-GB', { hour12: false }) : ''
  const refresh = () => { setRefreshing(true); items.reload() }

  return (
    <div>
      <PageHeader title="Live Production Monitor"
        subtitle={<>Every open item across production and the warehouse.{time && <> <span className="whitespace-nowrap">Updated {time} · refreshes every {REFRESH_SECONDS} s</span></>}</>}
        actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={refreshing} onClick={refresh}>Refresh</Button>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Open items" value={num(counts.all)} icon={<Layers className="h-5 w-5" />} tone="brand" active={bucket === 'all'} onClick={() => setBucket('all')} />
        <StatCard label="In production" value={num(counts.production)} icon={<Factory className="h-5 w-5" />} tone="brand" active={bucket === 'production'} onClick={() => setBucket('production')} />
        <StatCard label="At QC" value={num(counts.qc)} icon={<ClipboardCheck className="h-5 w-5" />} tone="green" active={bucket === 'qc'} onClick={() => setBucket('qc')} />
        <StatCard label="Rework" value={num(counts.rework)} hint={counts.rework ? `${num(reworkNow)} in rework now` : undefined} icon={<RotateCcw className="h-5 w-5" />} tone="red" active={bucket === 'rework'} onClick={() => setBucket('rework')} />
        <StatCard label="Delayed" value={num(counts.delayed)} icon={<AlertTriangle className="h-5 w-5" />} tone="orange" active={bucket === 'delayed'} onClick={() => setBucket('delayed')} />
        <StatCard label="In warehouse / ready" value={num(counts.warehouse)} icon={<Warehouse className="h-5 w-5" />} tone="gold" active={bucket === 'warehouse'} onClick={() => setBucket('warehouse')} />
      </div>

      <Card className="mt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Field label="Search" className="col-span-2 xl:col-span-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item, customer, product…" aria-label="Search" />
            </div>
          </Field>
          <Field label="Site">
            <Select value={filters.site_id} onChange={(e) => set('site_id', e.target.value)}>
              <option value="">All sites</option>
              {(meta.data?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </Select>
          </Field>
          <Field label="APM">
            <Select value={filters.apm_id} onChange={(e) => set('apm_id', e.target.value)}>
              <option value="">All APMs</option>
              {(apms.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={filters.stage} onChange={(e) => set('stage', e.target.value)}>
              <option value="">All stages</option>
              {stageOrder.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={filters.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">All categories</option>
              {(meta.data?.masters?.product_category ?? []).map((c) => <option key={c.code} value={c.name}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Order date from">
            <Input type="date" value={filters.date_from} max={filters.date_to || undefined} invalid={badDates} onChange={(e) => set('date_from', e.target.value)} />
          </Field>
          <Field label="Order date to">
            <Input type="date" value={filters.date_to} min={filters.date_from || undefined} invalid={badDates} onChange={(e) => set('date_to', e.target.value)} />
          </Field>
        </div>
        {(anyFilter || badDates) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {badDates && <span className="font-medium text-red-600">The "from" date is after the "to" date.</span>}
            {bucket !== 'all' && <Pill tone="brand">Showing: {BUCKET_LABEL[bucket]}</Pill>}
            {anyFilter && <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={clear}>Clear filters</Button>}
          </div>
        )}
      </Card>

      <ErrorNote error={items.error || meta.error} className="mt-4" />

      {items.loading && !items.data ? <Spinner label="Loading open items…" /> : items.data && (
        <>
          <Card className="mt-4" title="Items per stage" subtitle={`${num(rows.length)} item${rows.length === 1 ? '' : 's'} in the current view`}>
            {perStage.length === 0 ? <Empty title="No open items in this view" hint="Change or clear the filters to see more items." /> : (
              <div style={{ height: Math.max(120, perStage.length * 30 + 36) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perStage} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
                    <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="stage" width={150} tick={{ fontSize: 12, fill: '#334155' }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [num(Number(v)), 'Items']} />
                    <Bar dataKey="count" name="Items" radius={[0, 4, 4, 0]} barSize={16} label={{ position: 'right', fontSize: 12, fill: '#334155' }}>
                      {perStage.map((s) => <Cell key={s.stage} fill={WAREHOUSE_STAGES.includes(s.stage) ? '#d4a63d' : /QC$/.test(s.stage) ? '#059669' : '#22355c'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="mt-4">
            <DataTable<Item> rows={rows} columns={columns} rowKey={(r) => r.id} searchable={false}
              exportName="Live Production Monitor" pageSize={25}
              onRowClick={(r) => navigate(`/items/${r.id}`)}
              emptyTitle="No open items match" emptyHint="Change or clear the filters to see more items."
              rowClassName={(r) => (r.delayed ? 'bg-orange-50/40' : undefined)} />
          </div>
        </>
      )}
    </div>
  )
}
