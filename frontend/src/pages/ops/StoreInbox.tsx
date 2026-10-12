// T1 Store Inbox: store requisitions from the APMs, processed by the Store Operator.
import { CheckCircle2, PackageCheck, PackageMinus, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, ErrorNote, Facts, Input, Modal, Notice, PageHeader, Pill, Spinner, StatusBadge, Tabs, cx, errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDateTime } from '../../lib/format'

interface Line {
  id: number
  material_code?: string
  material_name?: string
  category?: string
  details?: string
  measurement?: string
  quantity: number
  issued_qty?: number
  colour_code?: string
  remarks?: string
}
interface Version { version: number; submitted_at?: string; return_reason?: string; returned_by?: string; lines?: Line[] }
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
  product_code?: string
  product_desc?: string
  site?: string
  lines: Line[]
  versions?: Version[]
}
type Tab = 'new' | 'partly' | 'processed' | 'all'

const qty = (v?: number | null) => (v === null || v === undefined ? '' : String(+v))
const TAB_STATUS: Record<Tab, string[] | null> = { new: ['Submitted'], partly: ['Partly Issued'], processed: ['Issued', 'Returned'], all: null }

export default function StoreInbox() {
  const { toast, confirm } = useUi()
  const { refreshBadges } = useAuth()
  const { data, loading, error, reload } = useLoad<Req[]>(() => api.get('/store-requisitions'))
  const [tab, setTab] = useState<Tab>('new')
  const [openId, setOpenId] = useState<number | null>(null)
  const [partly, setPartly] = useState(false)
  const [issued, setIssued] = useState<Record<number, string>>({})
  const [lineErr, setLineErr] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState('')

  const all = data ?? []
  const count = (t: Tab) => all.filter((r) => TAB_STATUS[t]!.includes(r.status)).length
  const rows = useMemo(() => {
    const want = TAB_STATUS[tab]
    const list = want ? all.filter((r) => want.includes(r.status)) : [...all]
    const rank = (r: Req) => (r.status === 'Submitted' ? 0 : r.status === 'Partly Issued' ? 1 : 2)
    return list.sort((a, b) => rank(a) - rank(b) || (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab])
  const req = all.find((r) => r.id === openId) ?? null
  const canAct = !!req && (req.status === 'Submitted' || req.status === 'Partly Issued')

  const openReq = (r: Req) => { setOpenId(r.id); setPartly(false); setLineErr({}) }
  const close = () => { if (!busy) { setOpenId(null); setPartly(false) } }
  const startPartly = () => {
    if (!req) return
    setIssued(Object.fromEntries(req.lines.map((l) => [l.id, qty(l.issued_qty ?? 0)])))
    setLineErr({})
    setPartly(true)
  }

  const send = async (key: string, body: Record<string, unknown>) => {
    if (!req) return
    setBusy(key)
    try {
      const r = await api.post(`/store-requisitions/${req.id}/process`, body)
      toast.success(r.message)
      setOpenId(null)
      setPartly(false)
      reload()
      refreshBadges()
    } catch (e) { toast.error(errText(e)) } finally { setBusy('') }
  }

  const issueAll = async () => {
    if (!req) return
    const ok = await confirm({ title: `Issue all materials on ${req.req_no}?`, message: 'Every line will be marked as issued in full. This cannot be undone.', confirmLabel: 'Issue all', tone: 'success' })
    if (ok) send('issue', { action: 'issue' })
  }
  const submitPartly = async () => {
    if (!req) return
    const errs: Record<number, string> = {}
    const lines = req.lines.map((l) => {
      const raw = (issued[l.id] ?? '').trim()
      const n = raw === '' ? 0 : Number(raw)
      if (Number.isNaN(n) || n < 0) errs[l.id] = 'Enter a number, 0 or more.'
      else if (n > l.quantity) errs[l.id] = `Cannot be more than ${qty(l.quantity)}.`
      return { id: l.id, issued_qty: n }
    })
    setLineErr(errs)
    if (Object.keys(errs).length) return
    if (!lines.some((l) => l.issued_qty > 0)) { toast.warn('Please enter the issued quantity for at least one line.'); return }
    const full = lines.every((l, i) => l.issued_qty === req.lines[i].quantity)
    const ok = await confirm({
      title: full ? `Issue all materials on ${req.req_no}?` : `Partly issue ${req.req_no}?`,
      message: full ? 'Every line is at its full quantity, so the requisition will be marked Issued.' : 'The quantities entered will be recorded as issued. The requisition stays open as Partly Issued.',
      confirmLabel: full ? 'Issue all' : 'Partly issue',
    })
    if (ok) send('partly', { action: 'partly', lines })
  }
  const returnReq = async () => {
    if (!req) return
    const reason = await confirm({
      title: `Return ${req.req_no} for correction?`, message: `${req.apm ?? 'The APM'} will be asked to correct the requisition and submit it again.`,
      confirmLabel: 'Return', tone: 'warn', reason: 'Reason for returning', reasonRequired: true,
    })
    if (typeof reason === 'string') send('return', { action: 'return', reason })
  }

  const columns: Column<Req>[] = [
    { key: 'req_no', header: 'Requisition No.', render: (r) => <span className="font-semibold text-brand-900">{r.req_no}</span> },
    { key: 'version', header: 'Version', value: (r) => `v${r.version}`, render: (r) => <Pill tone={r.version > 1 ? 'orange' : 'slate'}>v{r.version}</Pill> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'apm', header: 'Submitted by (APM)' },
    { key: 'site', header: 'Site' },
    { key: 'item_no', header: 'Item No.' },
    { key: 'product_name', header: 'Product', render: (r) => <span className="font-medium text-brand-950">{r.product_name}</span> },
    { key: 'product_code', header: 'Product code' },
    { key: 'product_desc', header: 'Description', className: 'max-w-56 truncate text-slate-600' },
    { key: 'lines', header: 'Lines', align: 'right', value: (r) => r.lines.length },
    { key: 'materials', header: 'Materials', value: (r) => r.lines.map((l) => l.material_name).filter(Boolean).join(', '), className: 'max-w-56 truncate text-slate-600' },
    { key: 'submitted_at', header: 'Submitted', render: (r) => fmtDateTime(r.submitted_at) },
    { key: 'processed_by', header: 'Processed by' },
  ]

  return (
    <>
      <PageHeader title="Store Inbox" subtitle="Material requisitions from the production sites. Issue, partly issue, or return each one for correction." />
      <Tabs<Tab> className="mb-4" value={tab} onChange={setTab}
        options={[
          { value: 'new', label: 'New', count: count('new') },
          { value: 'partly', label: 'Partly Issued', count: count('partly') },
          { value: 'processed', label: 'Processed' },
          { value: 'all', label: 'All' },
        ]} />

      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <DataTable rows={rows} columns={columns}rowKey={(r) => r.id} onRowClick={openReq} exportName="Store requisitions"
          searchPlaceholder="Search requisition, item, product, APM…"
          emptyTitle={tab === 'new' ? 'No new requisitions' : 'No requisitions here'}
          emptyHint={tab === 'new' ? 'New store requisitions from the APMs appear here.' : undefined}
          rowClassName={(r) => (r.status === 'Submitted' ? 'bg-slate-50/80' : undefined)} />
      )}

      <Modal open={!!req} onClose={close} size="xl"
        title={req ? <span className="flex flex-wrap items-center gap-2">{req.req_no} <Pill tone={req.version > 1 ? 'orange' : 'slate'}>v{req.version}</Pill> <StatusBadge status={req.status} /></span> : ''}
        footer={req && canAct ? (partly ? (
          <>
            <Button size="lg" variant="secondary" onClick={() => setPartly(false)} disabled={!!busy}>Back</Button>
            <Button size="lg" icon={<PackageMinus className="h-5 w-5" />} loading={busy === 'partly'} onClick={submitPartly}>Save issued quantities</Button>
          </>
        ) : (
          <>
            {req.status === 'Submitted' && <Button size="lg" variant="secondary" className="sm:mr-auto" icon={<Undo2 className="h-5 w-5" />} loading={busy === 'return'} disabled={!!busy} onClick={returnReq}>Return for correction</Button>}
            <Button size="lg" variant="gold" icon={<PackageMinus className="h-5 w-5" />} disabled={!!busy} onClick={startPartly}>Partly issue</Button>
            <Button size="lg" variant="success" icon={<PackageCheck className="h-5 w-5" />} loading={busy === 'issue'} disabled={!!busy} onClick={issueAll}>Issue all</Button>
          </>
        )) : undefined}>
        {req && (
          <div className="space-y-4">
            {req.status === 'Returned' && req.return_reason && <Notice tone="warn"><b>Returned for correction:</b> {req.return_reason}</Notice>}
            {req.status === 'Issued' && <Notice tone="success"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> All materials on this requisition have been issued.</span></Notice>}
            <Facts cols={3} items={[
              ['Submitted by (APM)', req.apm],
              ['Site', req.site],
              ['Item No.', req.item_no],
              ['Product', [req.product_name, req.product_code].filter(Boolean).join(' · ')],
              ['Product description', req.product_desc],
              ['Submitted', req.submitted_at ? fmtDateTime(req.submitted_at) : null],
              ['Processed', req.processed_at ? fmtDateTime(req.processed_at) : null],
              ['Processed by', req.processed_by],
            ]} />

            {partly && <Notice>Enter the quantity issued for each line, from 0 up to the requested quantity.</Notice>}
            <div>
              <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-brand-900">Material lines ({req.lines.length})</p>
              <LineList lines={req.lines} edit={partly ? { issued, setIssued, lineErr } : undefined} />
            </div>

            {!!req.versions?.length && (
              <div>
                <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-brand-900">Earlier versions</p>
                <div className="space-y-2">
                  {[...req.versions].reverse().map((v) => (
                    <details key={v.version} className="rounded-lg border border-slate-200 bg-slate-50/60">
                      <summary className="cursor-pointer px-3.5 py-3 text-sm font-semibold text-brand-950">
                        Version {v.version}{v.submitted_at ? ` · submitted ${fmtDateTime(v.submitted_at)}` : ''}
                      </summary>
                      <div className="space-y-3 px-3.5 pb-3.5">
                        {v.return_reason && <Notice tone="warn"><b>Returned{v.returned_by ? ` by ${v.returned_by}` : ''}:</b> {v.return_reason}</Notice>}
                        <LineList lines={v.lines ?? []} />
                      </div>
                    </details>
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

interface EditState { issued: Record<number, string>; setIssued: (fn: (p: Record<number, string>) => Record<number, string>) => void; lineErr: Record<number, string> }

function LineList({ lines, edit }: { lines: Line[]; edit?: EditState }) {
  if (!lines.length) return <p className="text-sm text-slate-500">No material lines.</p>
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {lines.map((l, i) => {
        const done = l.issued_qty !== undefined && l.issued_qty >= l.quantity
        return (
          <div key={l.id ?? i} className="rounded-lg border border-slate-200 bg-white p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-brand-950">{l.material_name}</p>
                <p className="text-xs text-slate-500">{[l.material_code, l.category].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-lg font-bold tabular text-brand-950">{qty(l.quantity)}{l.measurement ? <span className="ml-1 text-xs font-medium text-slate-500">{l.measurement}</span> : null}</p>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Requested</p>
              </div>
            </div>
            <div className="mt-2.5">
              <Facts cols={2} items={[
                ['Details', l.details],
                ['Colour code', l.colour_code],
                ['Remarks', l.remarks],
                ['Issued quantity', !edit && l.issued_qty !== undefined
                  ? <span className={cx(done ? 'text-emerald-700' : 'text-amber-700')}>{qty(l.issued_qty)} of {qty(l.quantity)}{l.measurement ? ` ${l.measurement}` : ''}</span> : null],
              ]} />
            </div>
            {edit && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Issued quantity (0 to {qty(l.quantity)})</span>
                  <div className="flex items-center gap-2">
                    <Input type="number" inputMode="decimal" min={0} max={l.quantity} step="any" className="!h-12 !text-base" value={edit.issued[l.id] ?? ''} invalid={!!edit.lineErr[l.id]}
                      onChange={(e) => { const v = e.target.value; edit.setIssued((p) => ({ ...p, [l.id]: v })) }} />
                    <Button variant="secondary" size="lg" onClick={() => edit.setIssued((p) => ({ ...p, [l.id]: qty(l.quantity) }))}>Full</Button>
                  </div>
                  {edit.lineErr[l.id] && <span role="alert" className="mt-1 block text-xs font-medium text-red-600">{edit.lineErr[l.id]}</span>}
                </label>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
