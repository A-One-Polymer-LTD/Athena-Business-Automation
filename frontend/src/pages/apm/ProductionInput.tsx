// Production Input: the items whose production data is being recorded for their Production Report (Workflows E and I).
// Opening a row shows the item's Stage Tracker (A4), where each stage records its part of the report.
import { ClipboardCheck, FileText, PackageCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, ErrorNote, Notice, PageHeader, Pill, ProgressBar, Spinner, StatusBadge, Tabs, useLoad } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'

interface Row {
  id: number
  item_no: string
  customer?: string
  product_name?: string
  site?: string
  apm?: string
  stage: string
  status?: string
  delayed?: boolean
  rework?: boolean
  next_step?: string
  blocked?: string
  report_done: number
  report_total: number
  report_missing?: string[]
}

type Tab = 'production' | 'missing' | 'warehouse' | 'all'
const WAREHOUSE = ['In Warehouse', 'Packed', 'Ready for Delivery']

export default function ProductionInput() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, loading, error } = useLoad<Row[]>(() => api.get('/production-input'))
  const [tab, setTab] = useState<Tab>('production')
  const canMove = user?.role === 'Assistant Production Manager' || user?.role === 'Super Admin'

  const all = data ?? []
  const groups = useMemo(() => ({
    production: all.filter((r) => !WAREHOUSE.includes(r.stage)),
    missing: all.filter((r) => (r.report_missing ?? []).length > 0),
    warehouse: all.filter((r) => WAREHOUSE.includes(r.stage)),
    all,
  }), [all])

  const columns: Column<Row>[] = [
    { key: 'item_no', header: 'Item No.', render: (r) => <span className="font-semibold text-brand-900">{r.item_no}</span> },
    { key: 'product_name', header: 'Product' },
    { key: 'customer', header: 'Customer' },
    { key: 'site', header: 'Site' },
    { key: 'apm', header: 'APM' },
    { key: 'stage', header: 'Current stage', render: (r) => (
      <span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={r.stage} />{r.rework && <Pill tone="red">Rework</Pill>}{r.delayed && <Pill tone="orange">Delayed</Pill>}</span>
    ) },
    ...(canMove ? [{ key: 'next_step', header: 'Next input', render: (r: Row) => (r.next_step ? <span className="text-sm font-medium text-brand-800">{r.next_step}</span>
      : <span className="text-xs text-slate-500">{r.blocked ?? 'Waiting on another step'}</span>) }] : []),
    { key: 'report', header: 'Report data', always: true, value: (r) => `${r.report_done}/${r.report_total}`, render: (r) => (
      <div className="min-w-[140px]">
        <div className="flex items-center gap-2">
          <ProgressBar value={(r.report_done / r.report_total) * 100} tone={(r.report_missing ?? []).length ? 'amber' : 'green'} className="w-20" />
          <span className="tabular text-xs font-semibold text-slate-700">{r.report_done}/{r.report_total}</span>
        </div>
        {(r.report_missing ?? []).length > 0 && <p className="mt-1 text-xs font-medium text-orange-700">Missing: {r.report_missing!.join(', ')}</p>}
      </div>
    ) },
  ]

  return (
    <div>
      <PageHeader title="Production Input"
        subtitle="Record each production step here. Every step adds its part to the item's Production Report."
        actions={<>
          <Link to="/qc-input"><Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />}>QC Input</Button></Link>
          <Link to="/reports"><Button variant="secondary" icon={<FileText className="h-4 w-4" />}>Production Reports</Button></Link>
        </>} />
      <Notice className="mb-4">
        <span className="font-semibold">How the Production Report is built:</span> requisitions record the materials, each stage move records its
        start, end, user and note, QC Input records the QC results and sign-offs, Finish Good records the final measurements, and the Production
        Cost sheet records the cost lines. When the warehouse marks the item <span className="font-semibold">Delivered</span>, the system
        generates the Production Report from these records. Open a row to record its next step.
      </Notice>
      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <>
          <Tabs<Tab> className="mb-3" value={tab} onChange={setTab} options={[
            { value: 'production', label: 'In production', count: groups.production.length },
            { value: 'missing', label: 'Missing report data', count: groups.missing.length },
            { value: 'warehouse', label: 'In warehouse', count: groups.warehouse.length },
            { value: 'all', label: 'All', count: all.length },
          ]} />
          <DataTable<Row> rows={groups[tab]} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/items/${r.id}`)}
            exportName="Production Input" searchPlaceholder="Search item no., product, customer, site…"
            rowClassName={(r) => ((r.report_missing ?? []).length ? 'bg-orange-50/40' : undefined)}
            emptyTitle={tab === 'missing' ? 'No item is missing report data' : 'No items here'}
            emptyHint={tab === 'production' ? <span className="inline-flex items-center gap-1.5"><PackageCheck className="h-4 w-4" />Items appear here once the Production Manager assigns them to a site.</span> : undefined} />
        </>
      )}
    </div>
  )
}
