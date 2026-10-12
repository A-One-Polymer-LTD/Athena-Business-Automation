// A1 My Work List: the APM's items grouped by stage, with the next step on every card.
import { AlertTriangle, ArrowRight, CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, Clock, Layers, MapPin, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthImage } from '../../components/AuthImage'
import { Button, Empty, ErrorNote, PageHeader, Pill, Select, Spinner, StatCard, StatusBadge, cx, errText, useLoad, useUi } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDate } from '../../lib/format'

interface Move { to: string; label: string; enabled: boolean; reason?: string; style?: string }
interface WorkItem {
  id: number
  item_no: string
  customer?: string
  product_name?: string
  product_code?: string
  stage: string
  status: string
  days_in_stage?: number
  delayed?: boolean
  rework?: boolean
  site?: string
  site_name?: string
  promised_date?: string
  upholstery_added?: boolean
  image?: string
  qc_ref?: string
  moves?: Move[]
}

const STAGE_ORDER = ['Assigned', 'Machine Room', 'Production Site', 'Machine Room (2nd pass)', 'Form/Design Ready', 'Carpenter', 'Carpenter QC',
  'Lacquer', 'Lacquer QC', 'Upholstery', 'Upholstery QC']
const QC_STAGES = ['Carpenter QC', 'Lacquer QC', 'Upholstery QC']
type Focus = 'all' | 'qc' | 'rework' | 'delayed'

const variantOf = (style?: string) => (style === 'success' ? 'success' : style === 'secondary' ? 'secondary' : 'primary')
const daysText = (d?: number) => (d === undefined || d === null ? null : d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'} in stage`)

export default function WorkList() {
  const navigate = useNavigate()
  const { toast, confirm } = useUi()
  const { refreshBadges } = useAuth()
  const { data, loading, error, reload } = useLoad<WorkItem[]>(() => api.get('/items?scope=production'))
  const [site, setSite] = useState('')
  const [q, setQ] = useState('')
  const [focus, setFocus] = useState<Focus>('all')
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')

  const items = data ?? []
  const sites = useMemo(() => [...new Set(items.map((i) => i.site).filter(Boolean) as string[])].sort(), [items])
  const stats = useMemo(() => ({
    open: items.length,
    qc: items.filter((i) => QC_STAGES.includes(i.stage)).length,
    rework: items.filter((i) => i.rework).length,
    delayed: items.filter((i) => i.delayed).length,
  }), [items])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((i) => {
      if (site && i.site !== site) return false
      if (focus === 'qc' && !QC_STAGES.includes(i.stage)) return false
      if (focus === 'rework' && !i.rework) return false
      if (focus === 'delayed' && !i.delayed) return false
      if (needle && ![i.item_no, i.product_name, i.product_code, i.customer, i.site, i.qc_ref].some((v) => (v ?? '').toLowerCase().includes(needle))) return false
      return true
    })
  }, [items, site, q, focus])

  const groups = useMemo(() => {
    const names = [...STAGE_ORDER, ...[...new Set(shown.map((i) => i.stage))].filter((s) => !STAGE_ORDER.includes(s))]
    return names.map((stage) => ({ stage, items: shown.filter((i) => i.stage === stage) })).filter((g) => g.items.length)
  }, [shown])

  const doMove = async (item: WorkItem, mv: Move) => {
    if (mv.to === 'Finish Good') { navigate(`/items/${item.id}`); return } // final measurements are confirmed on the item screen
    const addsUpholstery = mv.to === 'Upholstery' && !item.upholstery_added
    const ok = await confirm({
      title: addsUpholstery ? `Add upholstery to ${item.item_no}?` : `${mv.label}?`,
      message: addsUpholstery
        ? 'Adding upholstery makes Upholstery QC required before Finish Good. Only the Production Manager can remove it afterwards.'
        : `${item.item_no} will move from ${item.stage} to ${mv.to}. Only the Production Manager can reverse a stage update.`,
      confirmLabel: mv.label, tone: addsUpholstery ? 'warn' : 'primary',
    })
    if (!ok) return
    setBusy(`${item.id}:${mv.to}`)
    try {
      const res = await api.post<{ message: string; warnings?: string[] }>(`/items/${item.id}/move`, { to: mv.to })
      toast.success(res.message)
      res.warnings?.forEach((w) => toast.warn(w))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy('')
      reload()
      refreshBadges()
    }
  }

  return (
    <div>
      <PageHeader title="My Work List" subtitle="Items on your sites, grouped by production stage."
        actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Refresh</Button>} />

      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Open items" value={stats.open} tone="brand" icon={<Layers className="h-5 w-5" />} active={focus === 'all'} onClick={() => setFocus('all')} />
            <StatCard label="At QC" value={stats.qc} tone="green" icon={<ClipboardCheck className="h-5 w-5" />} active={focus === 'qc'} onClick={() => setFocus(focus === 'qc' ? 'all' : 'qc')} />
            <StatCard label="Rework" value={stats.rework} tone="red" icon={<RotateCcw className="h-5 w-5" />} active={focus === 'rework'} onClick={() => setFocus(focus === 'rework' ? 'all' : 'rework')} />
            <StatCard label="Delayed" value={stats.delayed} tone="orange" icon={<AlertTriangle className="h-5 w-5" />} active={focus === 'delayed'} onClick={() => setFocus(focus === 'delayed' ? 'all' : 'delayed')} />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" placeholder="Search item no., product, customer…"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </div>
            {sites.length > 1 && (
              <div className="w-40">
                <Select aria-label="Site" className="!h-11" value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">All sites</option>
                  {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
            )}
            {(focus !== 'all' || site || q) && <Button variant="ghost" onClick={() => { setFocus('all'); setSite(''); setQ('') }}>Clear filters</Button>}
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white shadow-card">
              <Empty title="No items on your sites right now" hint="Items appear here when the Production Manager assigns them to one of your sites." />
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white shadow-card">
              <Empty title="No items match these filters" hint="Try a different search or clear the filters." />
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => {
                const isQc = QC_STAGES.includes(g.stage)
                const open = !closed[g.stage]
                return (
                  <section key={g.stage}>
                    <button type="button" aria-expanded={open} onClick={() => setClosed((c) => ({ ...c, [g.stage]: open }))}
                      className={cx('flex min-h-[48px] w-full items-center gap-3 rounded-xl border bg-white px-4 py-2.5 text-left shadow-card transition hover:border-brand-400',
                        isQc ? 'border-emerald-400' : 'border-slate-200')}>
                      {open ? <ChevronDown className="h-5 w-5 text-slate-500" /> : <ChevronRight className="h-5 w-5 text-slate-500" />}
                      <span className={cx('h-2.5 w-2.5 rounded-full', isQc ? 'border-2 border-emerald-500 bg-white' : 'bg-blue-500')} aria-hidden />
                      <span className="flex-1 text-[15px] font-bold text-brand-950">{g.stage}</span>
                      {isQc && <span className="hidden text-xs font-semibold text-emerald-700 sm:inline">Quality check</span>}
                      <span className="tabular rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-800">{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
                    </button>
                    {open && (
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                        {g.items.map((it) => (
                          <article key={it.id} className={cx('flex flex-col rounded-xl border bg-white shadow-card', it.rework ? 'border-red-300' : it.delayed ? 'border-orange-300' : 'border-slate-200')}>
                            <button type="button" onClick={() => navigate(`/items/${it.id}`)} aria-label={`Open ${it.item_no}`}
                              className="flex w-full gap-3 rounded-t-xl p-4 text-left transition hover:bg-brand-50/50">
                              <AuthImage file={it.image} alt={it.product_name ?? ''} className="h-20 w-20 shrink-0 rounded-lg border border-slate-200" />
                              <span className="block min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                  <span className="tabular block truncate text-[15px] font-bold text-brand-950">{it.item_no}</span>
                                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                </span>
                                {it.product_name && <span className="block truncate text-sm font-semibold text-slate-800">{it.product_name}</span>}
                                {it.customer && <span className="block truncate text-sm text-slate-500">{it.customer}</span>}
                                <span className="mt-1.5 flex flex-wrap gap-1.5">
                                  <StatusBadge status={it.status} />
                                  {it.rework && it.status !== 'Rework' && <Pill tone="red">Rework</Pill>}
                                  {it.delayed && <Pill tone="orange">Delayed</Pill>}
                                  {it.upholstery_added && <Pill tone="gold">Upholstery</Pill>}
                                </span>
                              </span>
                            </button>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-600">
                              {it.site && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {it.site}</span>}
                              {daysText(it.days_in_stage) && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {daysText(it.days_in_stage)}</span>}
                              {it.promised_date && (
                                <span className={cx('inline-flex items-center gap-1', it.delayed && 'text-orange-700')}><CalendarDays className="h-3.5 w-3.5" /> Promised {fmtDate(it.promised_date)}</span>
                              )}
                            </div>
                            <div className="mt-auto rounded-b-xl border-t border-slate-100 bg-slate-50/70 p-3">
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Next step</p>
                              {it.moves?.length ? (
                                <div className="space-y-2">
                                  {it.moves.map((mv) => (
                                    <div key={mv.to + mv.label}>
                                      <Button size="lg" variant={variantOf(mv.style)} className="w-full" disabled={!mv.enabled || (!!busy && busy !== `${it.id}:${mv.to}`)}
                                        loading={busy === `${it.id}:${mv.to}`} title={!mv.enabled ? mv.reason : undefined} onClick={() => doMove(it, mv)}
                                        icon={mv.to === 'Finish Good' && mv.enabled ? <ArrowRight className="h-4 w-4" /> : undefined}>
                                        {mv.to === 'Finish Good' && mv.enabled ? 'Finish Good: confirm measurements' : mv.label}
                                      </Button>
                                      {!mv.enabled && mv.reason && <p className="mt-1 text-xs font-medium text-orange-800">{mv.reason}</p>}
                                    </div>
                                  ))}
                                </div>
                              ) : <p className="text-sm text-slate-500">No step is open for this item.</p>}
                              {QC_STAGES.includes(it.stage) && (
                                <Button variant="ghost" className="mt-2 w-full" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => navigate(`/items/${it.id}`)}>Record QC results</Button>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
