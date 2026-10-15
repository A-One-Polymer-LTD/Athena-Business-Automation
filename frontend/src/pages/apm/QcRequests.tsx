// QC Requests (A5, Workflow F): every Carpenter, Lacquer and Upholstery QC request with who sent it, who reviews it,
// its status and the next action. The reviewer approves or rejects here; the final QC sign-offs are on the Sign-off tab.
import { ArrowRight, ClipboardCheck, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QcSheet from '../../components/QcSheet'
import { QcReviewPanel, QcTracker, RequestStatus, type QcRequest, type QcStageTrack } from '../../components/QcRequest'
import { Button, Card, Empty, ErrorNote, Input, Notice, PageHeader, Pill, Spinner, StatusBadge, Tabs, cx, errText, useLoad, useUi } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDateTime, hoursLabel } from '../../lib/format'

type Tab = 'assigned' | 'sent' | 'pending' | 'decided' | 'signoff'
interface SignoffRow { id: number; item_no: string; customer?: string; product_name?: string; site?: string; apm?: string; qc_ref?: string; apm_signed_by?: string; pm_signed_by?: string; todo: string }
interface Move { to: string; label: string; enabled: boolean; style?: string }
type Sel = { kind: 'request'; id: number; itemId: number } | { kind: 'signoff'; itemId: number }

/** The selected request or sign-off: review panel, next step, QC tracking and the unified QC report. */
function Detail({ sel, onChanged }: { sel: Sel; onChanged: () => void }) {
  const { refreshBadges } = useAuth()
  const { toast, confirm } = useUi()
  const { data: item, loading, error, reload } = useLoad<any>(() => api.get(`/items/${sel.itemId}`), [sel.itemId])
  const [busy, setBusy] = useState('')
  if (loading) return <Spinner />
  if (error || !item) return <ErrorNote error={error || 'Item not found.'} />
  const changed = () => { reload(); onChanged(); refreshBadges() }
  const tracker: QcStageTrack[] = item.qc_tracker ?? []
  const req = sel.kind === 'request' ? tracker.flatMap((t) => t.requests).find((r) => r.id === sel.id) : undefined
  // once the stage is approved, the APM's next move is offered here (Finish Good needs the final measurements)
  const moves: Move[] = req?.status === 'Approved' ? (item.moves ?? []).filter((m: Move) => m.enabled && m.to !== 'Finish Good') : []
  const finishGood = req?.status === 'Approved' && (item.moves ?? []).some((m: Move) => m.enabled && m.to === 'Finish Good')

  const move = async (mv: Move) => {
    const note = await confirm({ title: `${mv.label}?`, message: `${item.item_no} will move from ${item.stage} to ${mv.to}.`, reason: 'Note (optional)', reasonRequired: false, confirmLabel: mv.label })
    if (note === false) return
    setBusy(mv.to)
    try {
      const res: any = await api.post(`/items/${sel.itemId}/move`, { to: mv.to, note: typeof note === 'string' ? note : undefined })
      toast.success(res.message)
      res.warnings?.forEach((w: string) => toast.warn(w))
    } catch (e) { toast.error(errText(e)) } finally { setBusy(''); changed() }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-card">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="tabular text-lg font-bold text-brand-950">{item.item_no}</h2>
            <StatusBadge status={item.status} />
            {item.upholstery_added && <Pill tone="gold">Upholstery</Pill>}
          </div>
          <p className="mt-0.5 text-sm text-slate-700">{[item.product_name, item.customer, item.site, item.apm ? `APM ${item.apm}` : null].filter(Boolean).join(' · ')}</p>
        </div>
        <Link to={`/items/${sel.itemId}`}><Button variant="secondary" size="sm" icon={<ExternalLink className="h-4 w-4" />}>Open item</Button></Link>
      </div>
      {req && <QcReviewPanel req={req} itemId={sel.itemId} onChanged={changed} />}
      {(moves.length > 0 || finishGood) && (
        <Notice tone="success">
          <p className="font-semibold">{req?.stage} is approved. Next step for the APM:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {moves.map((mv) => (
              <Button key={mv.to} size="sm" variant={mv.style === 'secondary' ? 'secondary' : 'primary'} loading={busy === mv.to} disabled={!!busy}
                icon={<ArrowRight className="h-4 w-4" />} onClick={() => move(mv)}>{mv.label}</Button>
            ))}
            {finishGood && <Link to={`/items/${sel.itemId}`}><Button size="sm" variant="success">Finish Good (confirm final measurements)</Button></Link>}
          </div>
        </Notice>
      )}
      <QcTracker tracker={tracker} />
      {item.qc ? <QcSheet itemId={sel.itemId} qc={item.qc} onChanged={changed} /> : <Card><Empty title="No QC report yet" hint="The QC report opens when the item reaches Carpenter QC." /></Card>}
    </div>
  )
}

export default function QcRequests() {
  const { user } = useAuth()
  const isPm = user?.role === 'Production Manager'
  const [tab, setTab] = useState<Tab>('assigned')
  const scope = tab === 'signoff' ? 'assigned' : tab
  const list = useLoad<QcRequest[]>(() => api.get(`/qc-requests?scope=${scope}`), [scope])
  const counts = useLoad<{ assigned: number; signoff: number }>(async () => {
    const [a, s] = await Promise.all([api.get<QcRequest[]>('/qc-requests?scope=assigned'), api.get<SignoffRow[]>('/qc-input')])
    return { assigned: a.length, signoff: s.filter((r) => r.todo === 'signoff').length }
  }, [])
  const signoffs = useLoad<SignoffRow[]>(() => (tab === 'signoff' ? api.get('/qc-input') : Promise.resolve([])), [tab])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Sel | null>(null)

  const needle = q.trim().toLowerCase()
  const match = (vals: (string | undefined)[]) => !needle || vals.some((v) => String(v ?? '').toLowerCase().includes(needle))
  const rows = useMemo(() => (list.data ?? []).filter((r) => match([r.request_no, r.item_no, r.customer, r.product_name, r.site, r.reviewer, r.submitted_by, r.stage])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.data, needle])
  const signRows = useMemo(() => (signoffs.data ?? []).filter((r) => r.todo === 'signoff' && match([r.item_no, r.customer, r.product_name, r.site, r.qc_ref])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signoffs.data, needle])

  // open the first entry of the tab; a decided request stays open so its next step can be recorded
  useEffect(() => { setSel(null) }, [tab])
  useEffect(() => {
    if (sel) return
    if (tab === 'signoff') { if (signRows[0]) setSel({ kind: 'signoff', itemId: signRows[0].id }) } else if (rows[0]) setSel({ kind: 'request', id: rows[0].id, itemId: rows[0].item_id! })
  }, [rows, signRows, sel, tab])

  const reloadAll = () => { list.reload(); counts.reload(); signoffs.reload() }
  const loading = tab === 'signoff' ? signoffs.loading : list.loading
  const error = tab === 'signoff' ? signoffs.error : list.error

  return (
    <div>
      <PageHeader title="QC Requests"
        subtitle="Carpenter, Lacquer and Upholstery QC requests: who sent each one, who reviews it, its status and the next action. Reviewers approve or reject here."
        actions={<Link to="/qc"><Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />}>All QC Reports</Button></Link>} />
      <div className="space-y-5">
        <div className="space-y-3">
          <Tabs<Tab> value={tab} onChange={setTab} options={[
            { value: 'assigned', label: user?.role === 'Super Admin' ? 'Waiting for review' : 'Sent to me', count: counts.data?.assigned },
            { value: 'sent', label: 'Sent by me' },
            { value: 'pending', label: 'All in review' },
            { value: 'decided', label: 'Approved / rejected' },
            { value: 'signoff', label: isPm ? 'My sign-off' : 'Sign-off', count: counts.data?.signoff },
          ]} />
          <div className="max-w-md"><Input placeholder="Search request, item, customer, reviewer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search QC requests" /></div>
          {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : tab === 'signoff' ? (
            signRows.length === 0 ? <Empty title="No QC report is waiting for your sign-off" hint="A report is ready for sign-off once every QC stage is approved." /> : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {signRows.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSel({ kind: 'signoff', itemId: r.id })} aria-current={sel?.itemId === r.id ? 'true' : undefined}
                      className={cx('w-full rounded-xl border bg-white px-4 py-3 text-left shadow-card transition hover:border-brand-300', sel?.itemId === r.id ? 'border-brand-600 ring-2 ring-brand-100' : 'border-slate-200')}>
                      <div className="flex items-center justify-between gap-2"><span className="tabular text-sm font-bold text-brand-950">{r.item_no}</span><Pill tone="brand">Sign-off</Pill></div>
                      <p className="mt-0.5 truncate text-sm text-slate-700">{[r.product_name, r.customer].filter(Boolean).join(' · ')}</p>
                      <p className="mt-1 text-xs text-slate-600">{r.qc_ref} · APM: {r.apm_signed_by ?? 'not signed'} · PM: {r.pm_signed_by ?? 'not signed'}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : rows.length === 0 ? (
            <Empty title={tab === 'assigned' ? 'No QC request is waiting for you' : 'No QC requests here'}
              hint="A QC request is created when an item is sent to Carpenter QC, Lacquer QC or Upholstery QC." />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setSel({ kind: 'request', id: r.id, itemId: r.item_id! })} aria-current={sel?.kind === 'request' && sel.id === r.id ? 'true' : undefined}
                    className={cx('w-full rounded-xl border bg-white px-4 py-3 text-left shadow-card transition hover:border-brand-300',
                      sel?.kind === 'request' && sel.id === r.id ? 'border-brand-600 ring-2 ring-brand-100' : 'border-slate-200')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-brand-950">{r.request_no}</span>
                      <RequestStatus status={r.status} />
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-slate-800">{r.stage}{r.round > 1 ? ` · Round ${r.round}` : ''} · <span className="tabular">{r.item_no}</span></p>
                    <p className="truncate text-sm text-slate-600">{[r.product_name, r.customer].filter(Boolean).join(' · ')}</p>
                    <p className="mt-1 text-xs text-slate-600"><span className="font-semibold">{r.submitted_by}</span> → <span className="font-semibold">{r.reviewer}</span> · {fmtDateTime(r.submitted_at)}</p>
                    {r.status === 'Pending'
                      ? <p className="mt-0.5 text-xs font-medium text-amber-800">Waiting {hoursLabel(r.waiting_hours ?? 0)}{(r.open_checks ?? []).length ? ` · to pass: ${r.open_checks!.join(', ')}` : ''}</p>
                      : r.next_action && <p className="mt-0.5 text-xs font-medium text-brand-800">{r.next_action}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {sel ? <Detail key={`${sel.kind}:${sel.itemId}:${sel.kind === 'request' ? sel.id : ''}`} sel={sel} onChanged={reloadAll} /> : (
          !loading && <Card><Empty title="Select a QC request" hint="Choose a request to see its details, review it, and follow every QC stage of the item." /></Card>
        )}
      </div>
    </div>
  )
}
