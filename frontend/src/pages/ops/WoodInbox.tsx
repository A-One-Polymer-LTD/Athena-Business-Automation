// W1 Wood Inbox: wood requisitions from the APMs, processed by the Saw-Mill Supervisor.
import { CheckCircle2, Play, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, ErrorNote, Facts, Modal, Notice, PageHeader, Pill, Spinner, StatusBadge, Tabs, errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDateTime } from '../../lib/format'

interface Version { version: number; submitted_at?: string; return_reason?: string; returned_by?: string; wood_category?: string; seasoning?: string; quantity?: number; measurement?: string }
interface Req {
  id: number
  req_no: string
  status: string
  version: number
  return_reason?: string
  submitted_at?: string
  processed_at?: string
  processed_by?: string
  apm?: string
  item_id: number
  item_no: string
  product_name?: string
  site?: string
  wood_category?: string
  seasoning?: string
  quantity?: number
  measurement?: string
  versions?: Version[]
}
type Tab = 'new' | 'progress' | 'completed' | 'returned' | 'all'
type Action = 'start' | 'complete' | 'return'

const TAB_STATUS: Record<Tab, string | null> = { new: 'Submitted', progress: 'In Progress', completed: 'Completed', returned: 'Returned', all: null }
const qty = (v?: number | null) => (v === null || v === undefined ? '' : String(+v))
const isOpen = (r: Req) => r.status === 'Submitted' || r.status === 'In Progress'

export default function WoodInbox() {
  const { toast, confirm } = useUi()
  const { refreshBadges } = useAuth()
  const { data, loading, error, reload } = useLoad<Req[]>(() => api.get('/wood-requisitions'))
  const [tab, setTab] = useState<Tab>('new')
  const [openId, setOpenId] = useState<number | null>(null)
  const [busy, setBusy] = useState('')

  const all = data ?? []
  const count = (t: Tab) => all.filter((r) => r.status === TAB_STATUS[t]).length
  const rows = useMemo(() => {
    const want = TAB_STATUS[tab]
    const list = want ? all.filter((r) => r.status === want) : [...all]
    const rank = (r: Req) => (r.status === 'Submitted' ? 0 : r.status === 'In Progress' ? 1 : 2)
    return list.sort((a, b) => rank(a) - rank(b) || (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab])
  const req = all.find((r) => r.id === openId) ?? null

  const act = async (r: Req, action: Action) => {
    const body: Record<string, unknown> = { action }
    if (action === 'complete') {
      const ok = await confirm({
        title: `Complete ${r.req_no}?`, message: `Confirm that the wood for ${r.item_no} has been supplied in full. This cannot be undone.`,
        confirmLabel: 'Complete', tone: 'success',
      })
      if (!ok) return
    }
    if (action === 'return') {
      const reason = await confirm({
        title: `Return ${r.req_no} for correction?`, message: `${r.apm ?? 'The APM'} will be asked to correct the requisition and submit it again.`,
        confirmLabel: 'Return', tone: 'warn', reason: 'Reason for returning', reasonRequired: true,
      })
      if (typeof reason !== 'string') return
      body.reason = reason
    }
    setBusy(`${action}-${r.id}`)
    try {
      const res = await api.post(`/wood-requisitions/${r.id}/process`, body)
      toast.success(res.message)
      setOpenId(null)
      reload()
      refreshBadges()
    } catch (e) { toast.error(errText(e)) } finally { setBusy('') }
  }

  const columns: Column<Req>[] = [
    { key: 'req_no', header: 'Requisition No.', render: (r) => <span className="font-semibold text-brand-900">{r.req_no}{r.version > 1 && <Pill tone="orange" className="ml-2">v{r.version}</Pill>}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'apm', header: 'APM' },
    { key: 'site', header: 'Site' },
    { key: 'item_no', header: 'Item No.' },
    { key: 'product_name', header: 'Product' },
    { key: 'wood_category', header: 'Wood category' },
    { key: 'seasoning', header: 'Seasoning' },
    { key: 'quantity', header: 'Quantity', align: 'right', render: (r) => qty(r.quantity) },
    { key: 'measurement', header: 'Measurement' },
    { key: 'submitted_at', header: 'Submitted', render: (r) => fmtDateTime(r.submitted_at) },
    {
      key: 'action', header: 'Action', noExport: true,
      render: (r) => (isOpen(r) ? (
        <span onClick={(e) => e.stopPropagation()}>
          {r.status === 'Submitted'
            ? <Button icon={<Play className="h-4 w-4" />} loading={busy === `start-${r.id}`} disabled={!!busy} onClick={() => act(r, 'start')}>Start</Button>
            : <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={busy === `complete-${r.id}`} disabled={!!busy} onClick={() => act(r, 'complete')}>Complete</Button>}
        </span>
      ) : null),
    },
  ]

  return (
    <>
      <PageHeader title="Wood Inbox" subtitle="Wood requisitions from the production sites. Start, complete, or return each one for correction." />
      <Tabs<Tab> className="mb-4" value={tab} onChange={setTab}
        options={[
          { value: 'new', label: 'New', count: count('new') },
          { value: 'progress', label: 'In Progress', count: count('progress') },
          { value: 'completed', label: 'Completed' },
          { value: 'returned', label: 'Returned' },
          { value: 'all', label: 'All' },
        ]} />

      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} exportName="Wood requisitions"
          searchPlaceholder="Search requisition, item, wood, APM…"
          emptyTitle={tab === 'new' ? 'No new requisitions' : 'No requisitions here'}
          emptyHint={tab === 'new' ? 'New wood requisitions from the APMs appear here.' : undefined}
          rowClassName={(r) => (r.status === 'Submitted' ? 'bg-slate-50/80' : undefined)} />
      )}

      <Modal open={!!req} onClose={() => { if (!busy) setOpenId(null) }} size="lg"
        title={req ? <span className="flex flex-wrap items-center gap-2">{req.req_no} {req.version > 1 && <Pill tone="orange">v{req.version}</Pill>} <StatusBadge status={req.status} /></span> : ''}
        footer={req && isOpen(req) ? (
          <>
            <Button size="lg" variant="secondary" className="sm:mr-auto" icon={<Undo2 className="h-5 w-5" />} loading={busy === `return-${req.id}`} disabled={!!busy} onClick={() => act(req, 'return')}>Return for correction</Button>
            {req.status === 'Submitted' && <Button size="lg" icon={<Play className="h-5 w-5" />} loading={busy === `start-${req.id}`} disabled={!!busy} onClick={() => act(req, 'start')}>Start</Button>}
            <Button size="lg" variant="success" icon={<CheckCircle2 className="h-5 w-5" />} loading={busy === `complete-${req.id}`} disabled={!!busy} onClick={() => act(req, 'complete')}>Complete</Button>
          </>
        ) : undefined}>
        {req && (
          <div className="space-y-4">
            {req.status === 'Returned' && req.return_reason && <Notice tone="warn"><b>Returned for correction:</b> {req.return_reason}</Notice>}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <Facts cols={4} items={[
                ['Wood category', req.wood_category],
                ['Seasoning', req.seasoning],
                ['Quantity', qty(req.quantity)],
                ['Measurement', req.measurement],
              ]} />
            </div>
            <Facts cols={3} items={[
              ['APM', req.apm],
              ['Site', req.site],
              ['Item No.', req.item_no],
              ['Product', req.product_name],
              ['Submitted', req.submitted_at ? fmtDateTime(req.submitted_at) : null],
              ['Processed', req.processed_at ? fmtDateTime(req.processed_at) : null],
              ['Processed by', req.processed_by],
            ]} />
            {!!req.versions?.length && (
              <div>
                <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-brand-900">Earlier versions</p>
                <div className="space-y-2">
                  {[...req.versions].reverse().map((v) => (
                    <div key={v.version} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
                      <p className="mb-2 text-sm font-semibold text-brand-950">Version {v.version}{v.submitted_at ? ` · submitted ${fmtDateTime(v.submitted_at)}` : ''}</p>
                      <Facts cols={4} items={[
                        ['Wood category', v.wood_category],
                        ['Seasoning', v.seasoning],
                        ['Quantity', qty(v.quantity)],
                        ['Measurement', v.measurement],
                      ]} />
                      {v.return_reason && <Notice tone="warn" className="mt-3"><b>Returned{v.returned_by ? ` by ${v.returned_by}` : ''}:</b> {v.return_reason}</Notice>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
