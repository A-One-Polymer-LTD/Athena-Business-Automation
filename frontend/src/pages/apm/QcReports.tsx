// Unified QC reports: one row per item, with sign-off status.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '../../components/DataTable'
import { ErrorNote, PageHeader, Pill, Spinner, StatusBadge, Tabs, useLoad } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDate } from '../../lib/format'

interface QcRow {
  item_id: number
  qc_ref: string
  item_no: string
  customer?: string
  product_name?: string
  site?: string
  stage: string
  status?: string
  created_at?: string
  carpenter: string
  lacquer: string
  upholstery?: string
  rework_count?: number
  apm_signed_by?: string
  pm_signed_by?: string
}

type Tab = 'all' | 'mine' | 'rework'

/** Pass green, Rework red, Pending grey: colour plus text. */
function Result({ value }: { value?: string }) {
  if (!value) return null
  return <StatusBadge status={value} />
}
const signed = (name?: string) => (name ? <span className="font-semibold text-emerald-800">{name}</span> : <span className="text-slate-500">Not signed</span>)

export default function QcReports() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, loading, error } = useLoad<QcRow[]>(() => api.get('/qc-reports'))
  const [tab, setTab] = useState<Tab>('all')
  const isApm = user?.role === 'Assistant Production Manager'
  const isPm = user?.role === 'Production Manager'
  const canSign = isApm || isPm

  const all = data ?? []
  const allPassed = (r: QcRow) => r.carpenter === 'Pass' && r.lacquer === 'Pass' && (!r.upholstery || r.upholstery === 'Pass')
  // A report can be signed once every required check is Pass (finished items always are).
  const waiting = useMemo(() => all.filter((r) => allPassed(r) && (isPm ? !r.pm_signed_by : isApm ? !r.apm_signed_by : false)), [all, isPm, isApm])
  const withRework = useMemo(() => all.filter((r) => (r.rework_count ?? 0) > 0), [all])
  const rows = tab === 'mine' ? waiting : tab === 'rework' ? withRework : all

  const columns: Column<QcRow>[] = [
    { key: 'qc_ref', header: 'QC Ref No.', render: (r) => <span className="font-semibold text-brand-900">{r.qc_ref}</span> },
    { key: 'created_at', header: 'Date', value: (r) => r.created_at?.slice(0, 10), render: (r) => fmtDate(r.created_at) },
    { key: 'item_no', header: 'Item' },
    { key: 'customer', header: 'Customer' },
    { key: 'product_name', header: 'Product' },
    { key: 'site', header: 'Site' },
    { key: 'carpenter', header: 'Carpenter QC', render: (r) => <Result value={r.carpenter} /> },
    { key: 'lacquer', header: 'Lacquer QC', render: (r) => <Result value={r.lacquer} /> },
    { key: 'upholstery', header: 'Upholstery QC', render: (r) => (r.upholstery ? <Result value={r.upholstery} /> : <span className="text-xs text-slate-400">Not needed</span>) },
    { key: 'rework_count', header: 'Rework', align: 'right', always: true, value: (r) => r.rework_count ?? 0,
      render: (r) => ((r.rework_count ?? 0) > 0 ? <Pill tone="red">Rework × {r.rework_count}</Pill> : <span className="text-slate-500">0</span>) },
    { key: 'apm_signed_by', header: 'APM sign-off', always: true, value: (r) => r.apm_signed_by ?? 'Not signed', render: (r) => signed(r.apm_signed_by) },
    { key: 'pm_signed_by', header: 'PM sign-off', always: true, value: (r) => r.pm_signed_by ?? 'Not signed', render: (r) => signed(r.pm_signed_by) },
    { key: 'stage', header: 'Stage', render: (r) => <StatusBadge status={r.stage} /> },
  ]

  return (
    <div>
      <PageHeader title="QC Reports" subtitle="One unified QC report per item. Open a row to see the full sheet." />
      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <>
          <Tabs<Tab> className="mb-3" value={tab} onChange={setTab} options={[
            { value: 'all', label: 'All', count: all.length },
            ...(canSign ? [{ value: 'mine' as Tab, label: 'Waiting for my sign-off', count: waiting.length }] : []),
            { value: 'rework', label: 'With rework', count: withRework.length },
          ]} />
          <DataTable<QcRow> rows={rows} columns={columns} rowKey={(r) => r.item_id} onRowClick={(r) => navigate(`/items/${r.item_id}`)}
            exportName="QC Reports" searchPlaceholder="Search QC Ref No., item, customer…"
            emptyTitle={tab === 'mine' ? 'No report is waiting for your sign-off' : tab === 'rework' ? 'No report has a rework' : 'No QC reports yet'}
            emptyHint={tab === 'all' ? 'A QC report is created automatically when an item reaches Carpenter QC.' : undefined} />
        </>
      )}
    </div>
  )
}
