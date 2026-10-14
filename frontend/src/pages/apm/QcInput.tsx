// QC Input (A5): items waiting for a QC result or for the user's sign-off, with the unified QC report beside the list.
// Results recorded here build the item's QC Report and the QC section of its Production Report (Workflow F).
import { ArrowRight, ClipboardCheck, ExternalLink, PenLine } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QcSheet from '../../components/QcSheet'
import { Button, Card, Empty, ErrorNote, Input, Notice, PageHeader, Pill, Spinner, StatusBadge, Tabs, cx, errText, useLoad, useUi } from '../../components/ui'
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
  todo: 'result' | 'signoff'
  qc_stage?: string
  qc_ref?: string
  open_checks?: string[]
  apm_signed_by?: string
  pm_signed_by?: string
  rework?: boolean
  image?: string
}
interface Move { to: string; label: string; enabled: boolean; reason?: string; style?: string }

type Tab = 'all' | 'result' | 'signoff'

function ItemQc({ itemId, onChanged }: { itemId: number; onChanged: () => void }) {
  const { refreshBadges } = useAuth()
  const { toast, confirm } = useUi()
  const { data: item, loading, error, reload } = useLoad<any>(() => api.get(`/items/${itemId}`), [itemId])
  const [busy, setBusy] = useState('')
  if (loading) return <Spinner />
  if (error || !item) return <ErrorNote error={error || 'Item not found.'} />
  const changed = () => { reload(); onChanged(); refreshBadges() }
  // after the last check of a QC stage passes, the next stage move is offered here as well
  const moves: Move[] = (item.moves ?? []).filter((m: Move) => m.enabled && m.to !== 'Finish Good')
  const finishGood = (item.moves ?? []).some((m: Move) => m.enabled && m.to === 'Finish Good')

  const move = async (mv: Move) => {
    const note = await confirm({
      title: `${mv.label}?`, message: `${item.item_no} will move from ${item.stage} to ${mv.to}.`,
      reason: 'Note (optional)', reasonRequired: false, confirmLabel: mv.label,
    })
    if (note === false) return
    setBusy(mv.to)
    try {
      const res: any = await api.post(`/items/${itemId}/move`, { to: mv.to, note: typeof note === 'string' ? note : undefined })
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
          <p className="mt-0.5 text-sm text-slate-700">{[item.product_name, item.customer, item.site].filter(Boolean).join(' · ')}</p>
        </div>
        <Link to={`/items/${itemId}`}><Button variant="secondary" size="sm" icon={<ExternalLink className="h-4 w-4" />}>Open item</Button></Link>
      </div>
      {(moves.length > 0 || finishGood) && (
        <Notice tone="success">
          <p className="font-semibold">Every check at this QC stage is Pass. Record the next step:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {moves.map((mv) => (
              <Button key={mv.to} size="sm" variant={mv.style === 'secondary' ? 'secondary' : 'primary'} loading={busy === mv.to} disabled={!!busy}
                icon={<ArrowRight className="h-4 w-4" />} onClick={() => move(mv)}>{mv.label}</Button>
            ))}
            {finishGood && <Link to={`/items/${itemId}`}><Button size="sm" variant="success">Finish Good (confirm final measurements)</Button></Link>}
          </div>
        </Notice>
      )}
      {item.qc ? <QcSheet itemId={itemId} qc={item.qc} onChanged={changed} /> : <Empty title="No QC report yet" hint="The QC report opens when the item reaches Carpenter QC." />}
    </div>
  )
}

export default function QcInput() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useLoad<Row[]>(() => api.get('/qc-input'))
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<number | null>(null)
  const isPm = user?.role === 'Production Manager'

  const all = data ?? []
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((r) => (tab === 'all' || r.todo === tab)
      && (!needle || [r.item_no, r.customer, r.product_name, r.site, r.qc_ref].some((v) => String(v ?? '').toLowerCase().includes(needle))))
  }, [all, tab, q])
  // open the first item; a finished item stays open so that its next step can be recorded
  useEffect(() => {
    if (data && !sel) setSel(rows[0]?.id ?? null)
  }, [data, rows, sel])

  const counts = { result: all.filter((r) => r.todo === 'result').length, signoff: all.filter((r) => r.todo === 'signoff').length }

  return (
    <div>
      <PageHeader title="QC Input"
        subtitle={isPm
          ? 'QC reports waiting for your sign-off. Your sign-off is added to the QC Report and the Production Report.'
          : 'Record QC results (Pass or Rework) and sign off. Each result is added to the item\'s unified QC Report and its Production Report.'}
        actions={<Link to="/qc"><Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />}>All QC Reports</Button></Link>} />
      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <div className="space-y-5">
          <div className="space-y-3">
            <Tabs<Tab> value={tab} onChange={setTab} options={[
              { value: 'all', label: 'All', count: all.length },
              ...(!isPm ? [{ value: 'result' as Tab, label: 'Results', count: counts.result }] : []),
              { value: 'signoff', label: 'Sign-off', count: counts.signoff },
            ]} />
            <div className="max-w-md"><Input placeholder="Search item, customer, QC Ref No.…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search QC queue" /></div>
            {rows.length === 0 ? (
              <Empty title="Nothing waiting for QC input" hint="Items appear here when they reach Carpenter QC, Lacquer QC or Upholstery QC, and when a report is ready for sign-off." />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSel(r.id)} aria-current={sel === r.id ? 'true' : undefined}
                      className={cx('w-full rounded-xl border bg-white px-4 py-3 text-left shadow-card transition hover:border-brand-300',
                        sel === r.id ? 'border-brand-600 ring-2 ring-brand-100' : 'border-slate-200')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="tabular text-sm font-bold text-brand-950">{r.item_no}</span>
                        {r.todo === 'result' ? <Pill tone="green">{r.qc_stage}</Pill> : <Pill tone="brand"><PenLine className="mr-1 inline h-3 w-3" />Sign-off</Pill>}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-700">{[r.product_name, r.customer].filter(Boolean).join(' · ')}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{[r.qc_ref, r.site, r.apm].filter(Boolean).join(' · ')}</p>
                      {r.todo === 'result' && (r.open_checks ?? []).length > 0 && <p className="mt-1 text-xs font-medium text-emerald-800">To record: {r.open_checks!.join(', ')}</p>}
                      {r.todo === 'signoff' && <p className="mt-1 text-xs text-slate-600">APM: {r.apm_signed_by ?? 'not signed'} · PM: {r.pm_signed_by ?? 'not signed'}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0">
            {sel ? <ItemQc key={sel} itemId={sel} onChanged={reload} /> : (
              <Card><Empty title="Select an item" hint="Choose an item from the list to record its QC results or sign off." /></Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
