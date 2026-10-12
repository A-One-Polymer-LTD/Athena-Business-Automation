// A4 Item Stage Tracker + A5 Unified QC Report. Shared by every role that may open an item;
// the API returns only what each role may see, so sections render only when their data is present.
import { ArrowLeft, Calculator, Check, FileText, MapPin, PackageCheck, Plus, RotateCcw, Shuffle, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ImageStrip } from '../../components/AuthImage'
import QcSheet from '../../components/QcSheet'
import {
  Button, Card, ErrorNote, Facts, Field, Input, Modal, Notice, Pill, Select, Spinner, StatusBadge, Textarea, cx, errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { currentSettings, dims, fmtDate, fmtDateTime, hoursLabel, money, num } from '../../lib/format'
import { StoreLinesTable, StoreRequisitionForm, type StoreReq } from './StoreRequisitions'
import { WoodRequisitionForm, type WoodReq } from './WoodRequisitions'

interface Move { to: string; label: string; enabled: boolean; reason?: string; style?: string }
interface HistoryRow { stage: string; kind?: string; started_at?: string; ended_at?: string; hours?: number; user?: string; note?: string }

const PRODUCTION = ['Assigned', 'Machine Room', 'Production Site', 'Machine Room (2nd pass)', 'Form/Design Ready', 'Carpenter', 'Carpenter QC',
  'Lacquer', 'Lacquer QC', 'Upholstery', 'Upholstery QC']
const AFTER = ['Finish Good', 'In Warehouse', 'Packed', 'Ready for Delivery', 'Delivered']
const QC_STAGES = ['Carpenter QC', 'Lacquer QC', 'Upholstery QC']
const KIND: Record<string, { label: string; tone: 'red' | 'orange' | 'brand' | 'slate' }> = {
  rework: { label: 'Rework', tone: 'red' }, reversal: { label: 'Reversal', tone: 'orange' },
  reassign: { label: 'Reassigned', tone: 'brand' }, undo: { label: 'Undo', tone: 'orange' },
}
const variantOf = (style?: string) => (style === 'success' ? 'success' : style === 'secondary' ? 'secondary' : 'primary')
const qty = (v?: number | null) => (v === undefined || v === null ? '—' : num(v, Number.isInteger(v) ? 0 : 2))

/** Horizontal stepper of the stages; optional stages appear only when used or currently possible. */
function StageTracker({ item }: { item: any }) {
  const history: HistoryRow[] = item.history ?? []
  const moves: Move[] = item.moves ?? []
  const seen = (s: string) => item.stage === s || history.some((h) => h.stage === s) || moves.some((m) => m.to === s)
  const showSecond = seen('Machine Room (2nd pass)')
  const showUph = !!item.upholstery_added || seen('Upholstery') || seen('Upholstery QC')
  const steps = [...PRODUCTION, ...AFTER].filter((s) => (s === 'Machine Room (2nd pass)' ? showSecond : s === 'Upholstery' || s === 'Upholstery QC' ? showUph : true))
  const current = steps.indexOf(item.stage)
  const optional = (s: string) => s === 'Machine Room (2nd pass)' || s === 'Upholstery' || s === 'Upholstery QC'

  return (
    <div className="overflow-x-auto pb-2">
      <ol className="flex min-w-max items-start">
        {steps.map((s, i) => {
          const done = current >= 0 && i < current
          const now = i === current
          const isQc = QC_STAGES.includes(s)
          const delivered = now && s === 'Delivered'
          const finished = now && AFTER.includes(s) && !delivered
          const dot = done ? 'border-brand-800 bg-brand-800 text-white'
            : delivered ? 'border-brand-800 bg-brand-800 text-white ring-4 ring-brand-200'
              : now && item.rework ? 'border-red-600 bg-red-600 text-white ring-4 ring-red-100'
                : finished ? 'border-gold-400 bg-gold-400 text-brand-950 ring-4 ring-gold-100'
                  : now && isQc ? 'border-emerald-500 bg-white text-emerald-700 ring-4 ring-emerald-100'
                    : now ? 'border-blue-600 bg-blue-600 text-white ring-4 ring-blue-100'
                      : 'border-slate-300 bg-white text-slate-400'
          return (
            <li key={s} aria-current={now ? 'step' : undefined} className="relative flex w-[104px] shrink-0 flex-col items-center px-1 text-center">
              {i > 0 && <span aria-hidden className={cx('absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2', current >= 0 && i <= current ? 'bg-brand-800' : 'bg-slate-200')} />}
              <span className={cx('relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold', dot)}>
                {done || delivered ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={cx('mt-2 text-xs leading-tight', now ? 'font-bold text-brand-950' : done ? 'font-semibold text-slate-700' : 'font-medium text-slate-400')}>{s}</span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {now ? <span className={item.rework ? 'text-red-600' : delivered ? 'text-brand-800' : finished ? 'text-gold-700' : isQc ? 'text-emerald-700' : 'text-blue-700'}>{item.rework ? 'Rework' : delivered ? 'Delivered' : 'Current'}</span>
                  : done ? <span className="text-slate-500">Done</span>
                    : optional(s) ? <span className="text-slate-400">Optional</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default function ItemDetail() {
  const { id } = useParams()
  const itemId = Number(id)
  const navigate = useNavigate()
  const { user, refreshBadges } = useAuth()
  const { toast, confirm } = useUi()
  const { data: item, loading, error, reload } = useLoad<any>(() => api.get(`/items/${itemId}`), [itemId])

  const [busy, setBusy] = useState('')
  const [finish, setFinish] = useState<{ h: string; w: string; l: string } | null>(null)
  const [finishErr, setFinishErr] = useState('')
  const [reqForm, setReqForm] = useState<'store' | 'wood' | null>(null)
  const [reassign, setReassign] = useState(false)
  const [siteId, setSiteId] = useState('')
  const [reason, setReason] = useState('')
  const [reassignErr, setReassignErr] = useState('')
  const sites = useLoad<any>(() => (reassign ? api.get('/meta') : Promise.resolve(null)), [reassign])

  if (loading) return <Spinner />
  if (error || !item) return (
    <div className="space-y-3">
      <ErrorNote error={error || 'Item not found.'} />
      <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>Back</Button>
    </div>
  )

  const role = user?.role
  const isApm = role === 'Assistant Production Manager'
  const isPm = role === 'Production Manager'
  const isSuper = role === 'Super Admin'
  const canOpenOrder = role === 'Sales Admin' || isPm || isSuper
  const moves: Move[] = item.moves ?? []
  const history: HistoryRow[] = item.history ?? []
  const storeReqs: StoreReq[] = item.store_requisitions ?? []
  const woodReqs: WoodReq[] = item.wood_requisitions ?? []
  const hasReqs = storeReqs.length + woodReqs.length > 0
  const inProduction = PRODUCTION.includes(item.stage)
  const unit = currentSettings().measurement_unit ?? 'in'

  const after = () => { reload(); refreshBadges() }

  /** Run one server action with a busy state, a success toast and a reload. */
  const run = async (key: string, fn: () => Promise<{ message?: string; warnings?: string[] }>) => {
    setBusy(key)
    try {
      const res = await fn()
      if (res?.message) toast.success(res.message)
      res?.warnings?.forEach((w) => toast.warn(w))
      after()
      return true
    } catch (e) {
      toast.error(errText(e))
      after()
      return false
    } finally { setBusy('') }
  }

  const doMove = async (mv: Move) => {
    if (mv.to === 'Finish Good') {
      setFinishErr('')
      setFinish({ h: item.height ? String(item.height) : '', w: item.width ? String(item.width) : '', l: item.length ? String(item.length) : '' })
      return
    }
    const addsUpholstery = mv.to === 'Upholstery' && !item.upholstery_added
    const ok = await confirm({
      title: addsUpholstery ? `Add upholstery to ${item.item_no}?` : `${mv.label}?`,
      message: addsUpholstery
        ? 'Adding upholstery makes Upholstery QC required before Finish Good. Only the Production Manager can remove it afterwards.'
        : `${item.item_no} will move from ${item.stage} to ${mv.to}. Only the Production Manager can reverse a stage update.`,
      confirmLabel: mv.label, tone: addsUpholstery ? 'warn' : 'primary',
    })
    if (ok) await run(`move:${mv.to}`, () => api.post(`/items/${itemId}/move`, { to: mv.to }))
  }

  const submitFinish = async () => {
    if (!finish) return
    const vals = [finish.h, finish.w, finish.l].map((v) => Number(v))
    if ([finish.h, finish.w, finish.l].some((v) => !v.trim()) || vals.some((v) => !Number.isFinite(v) || v <= 0)) {
      setFinishErr('Please enter the final Height, Width and Length. Each must be more than 0.')
      return
    }
    const ok = await run('move:Finish Good', () => api.post(`/items/${itemId}/move`, { to: 'Finish Good', final_height: vals[0], final_width: vals[1], final_length: vals[2] }))
    if (ok) setFinish(null)
  }

  const noRequisition = async () => {
    const remark = await confirm({
      title: 'No requisition needed?', message: 'Confirm that this item needs no store or wood requisition. Machine Room can then start.',
      reason: 'Remark', confirmLabel: 'Confirm',
    })
    if (typeof remark === 'string') await run('noreq', () => api.post(`/items/${itemId}/no-requisition`, { remark }))
  }

  const withReason = async (key: string, title: string, message: string, path: string, label: string) => {
    const r = await confirm({ title, message, reason: true, confirmLabel: label, tone: 'danger' })
    if (typeof r === 'string') await run(key, () => api.post(path, { reason: r }))
  }

  const submitReassign = async () => {
    if (!siteId) { setReassignErr('Please select a site.'); return }
    if (isSuper && !reason.trim()) { setReassignErr('Please enter a reason for reassigning this item.'); return }
    const ok = await run('assign', () => api.post(`/items/${itemId}/assign`, { site_id: Number(siteId), ...(isSuper ? { reason: reason.trim() } : {}) }))
    if (ok) setReassign(false)
  }

  const reqDone = (message: string) => { toast.success(message); setReqForm(null); after() }

  const canReassign = (isPm && item.stage === 'Assigned') || (isSuper && inProduction)
  const canReverse = (isPm || isSuper) && inProduction && item.stage !== 'Assigned'
  const canRemoveUph = isPm && !!item.upholstery_added && !(item.qc?.checks?.upholstery?.history?.length)
  const canUndoWh = isSuper && (item.stage === 'Packed' || item.stage === 'Ready for Delivery')
  const showCostLink = (isPm || isSuper) && !!user?.can_view_cost
  const hasRoleActions = canReassign || canReverse || canRemoveUph || canUndoWh || showCostLink
  const costLines = (item.cost?.lines ?? []).filter((l: any) => !l.voided).length
  const finalDims = item.final_height || item.final_width || item.final_length ? dims(item.final_height, item.final_width, item.final_length) : null
  const siteOptions: any[] = (sites.data?.sites ?? []).filter((s: any) => s.active && s.id !== item.site_id)

  return (
    <div className="space-y-5">
      <div className="space-y-5 no-print">
        {/* header */}
        <div>
          <button type="button" onClick={() => navigate(-1)} className="mb-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg pr-2 text-sm font-semibold text-brand-700 hover:text-brand-900">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="tabular text-[22px] font-bold leading-tight tracking-tight text-brand-950">{item.item_no}</h1>
                <StatusBadge status={item.status} />
                {item.rework && item.status !== 'Rework' && <Pill tone="red">Rework</Pill>}
                {item.delayed && <Pill tone="orange">Delayed</Pill>}
                {item.upholstery_added && <Pill tone="gold">Upholstery</Pill>}
              </div>
              {item.product_name && <p className="mt-1 text-[15px] font-semibold text-slate-800">{item.product_name}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item.report && <Link to={`/reports/${item.report.id}`}><Button variant="secondary" icon={<FileText className="h-4 w-4" />}>Production Report</Button></Link>}
              {canOpenOrder && item.order_id && <Link to={`/orders/${item.order_id}`}><Button variant="secondary">Open order {item.order_no}</Button></Link>}
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-card">
            <Facts cols={4} items={[
              ['Customer', item.customer], ['Order No.', item.order_no],
              ['Site', item.site ? `${item.site}${item.site_name ? ` · ${item.site_name}` : ''}` : null], ['APM', item.apm],
              ['Promised date', item.promised_date ? <span className={item.delayed ? 'text-orange-700' : undefined}>{fmtDate(item.promised_date)}</span> : null],
              ['Stage', item.stage],
              ['Days in stage', item.days_in_stage !== undefined && item.days_in_stage !== null ? (item.days_in_stage === 0 ? 'Since today' : `${item.days_in_stage} day${item.days_in_stage === 1 ? '' : 's'}`) : null],
              ['Rework count', item.rework_count ? String(item.rework_count) : null],
              ['Branch', item.branch], ['Sales Admin', item.sales_admin],
            ]} />
          </div>
        </div>

        {/* product */}
        <Card title="Product">
          <div className="space-y-4">
            <ImageStrip images={item.images} />
            <Facts cols={3} items={[
              ['Product Code', item.product_code], ['Category', item.category], ['Product Description', item.product_desc],
              ['Design Description', item.design_desc],
              ['Ordered H / W / L', item.height || item.width || item.length ? dims(item.height, item.width, item.length) : null],
              ['Final confirmed H / W / L', finalDims],
              ['Colour', [item.colour_name ?? item.colour, item.colour_code].filter(Boolean).join(' · ') || null],
              ['Kind of Wood', item.wood_category], ['Seasoning', item.seasoning],
              ['Upholstery', item.upholstery_added ? 'Added' : item.upholstery_needed ? 'Requested on the order' : null],
            ]} />
          </div>
        </Card>

        {/* stage tracker */}
        <Card title="Stage tracker" subtitle={item.stage_since ? `In ${item.stage} since ${fmtDateTime(item.stage_since)}` : undefined}>
          <StageTracker item={item} />

          {isApm && item.stage === 'Assigned' && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-[13px] font-bold uppercase tracking-wider text-brand-900">Requisitions before Machine Room</p>
              {hasReqs ? (
                <ul className="mt-2 space-y-1.5">
                  {storeReqs.map((r) => <li key={`s${r.id}`} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-brand-950">{r.req_no}</span><span className="text-slate-500">Store</span><StatusBadge status={r.status} /></li>)}
                  {woodReqs.map((r) => <li key={`w${r.id}`} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-brand-950">{r.req_no}</span><span className="text-slate-500">Wood</span><StatusBadge status={r.status} /></li>)}
                </ul>
              ) : item.no_req_remark ? (
                <Notice tone="success" className="mt-2"><span className="font-semibold">No requisition needed:</span> {item.no_req_remark}</Notice>
              ) : (
                <p className="mt-1 text-sm text-slate-600">No requisition has been submitted for this item yet. Submit one, or confirm that none is needed.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="lg" icon={<Plus className="h-4 w-4" />} onClick={() => setReqForm('store')}>New Store Requisition</Button>
                <Button variant="secondary" size="lg" icon={<Plus className="h-4 w-4" />} onClick={() => setReqForm('wood')}>New Wood Requisition</Button>
                {!hasReqs && !item.no_req_remark && <Button variant="ghost" size="lg" loading={busy === 'noreq'} onClick={noRequisition}>No requisition needed</Button>}
              </div>
            </div>
          )}

          {isApm && moves.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Next step</p>
              <div className="flex flex-wrap items-start gap-3">
                {moves.map((mv) => (
                  <div key={mv.to + mv.label} className="w-full sm:w-auto sm:max-w-xs">
                    <Button size="lg" variant={variantOf(mv.style)} className="w-full sm:min-w-[220px]" disabled={!mv.enabled || (!!busy && busy !== `move:${mv.to}`)}
                      loading={busy === `move:${mv.to}` && !finish} title={!mv.enabled ? mv.reason : undefined} onClick={() => doMove(mv)}
                      icon={mv.to === 'Finish Good' ? <PackageCheck className="h-5 w-5" /> : undefined}>
                      {mv.label}
                    </Button>
                    {!mv.enabled && mv.reason && <p className="mt-1.5 text-xs font-medium text-orange-800">{mv.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {isApm && inProduction && item.stage !== 'Assigned' && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Button variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setReqForm('store')}>New Store Requisition</Button>
              <Button variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setReqForm('wood')}>New Wood Requisition</Button>
            </div>
          )}
        </Card>

        {/* requisitions */}
        {(hasReqs || (item.no_req_remark && !(isApm && item.stage === 'Assigned'))) && (
          <Card title="Requisitions">
            <div className="space-y-4">
              {!hasReqs && item.no_req_remark && <Notice tone="info"><span className="font-semibold">No requisition needed:</span> {item.no_req_remark}</Notice>}
              {storeReqs.map((r) => (
                <div key={`s${r.id}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-brand-950">{r.req_no}</span>
                    <Pill tone="slate">Store</Pill>
                    <StatusBadge status={r.status} />
                    {r.version > 1 && <span className="text-xs text-slate-500">Version {r.version}</span>}
                    {r.submitted_at && <span className="text-xs text-slate-500">Submitted {fmtDate(r.submitted_at)}</span>}
                  </div>
                  {r.return_reason && <p className="mb-2 text-sm font-medium text-orange-800">Returned: {r.return_reason}</p>}
                  <StoreLinesTable lines={r.lines} />
                </div>
              ))}
              {woodReqs.map((r) => (
                <div key={`w${r.id}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-brand-950">{r.req_no}</span>
                    <Pill tone="slate">Wood</Pill>
                    <StatusBadge status={r.status} />
                    {r.version > 1 && <span className="text-xs text-slate-500">Version {r.version}</span>}
                    {r.submitted_at && <span className="text-xs text-slate-500">Submitted {fmtDate(r.submitted_at)}</span>}
                  </div>
                  {r.return_reason && <p className="mb-1 text-sm font-medium text-orange-800">Returned: {r.return_reason}</p>}
                  <p className="text-sm text-slate-700">{[r.wood_category, r.seasoning, `Qty ${qty(r.quantity)}`, r.measurement].filter(Boolean).join(' · ')}</p>
                </div>
              ))}
              {isApm && storeReqs.concat(woodReqs as any[]).some((r) => r.status === 'Returned') && (
                <p className="text-sm text-slate-600">
                  Returned requisitions are edited and resubmitted from <Link className="font-semibold text-brand-700 underline" to="/apm/store-requisitions">Store Requisitions</Link> or <Link className="font-semibold text-brand-700 underline" to="/apm/wood-requisitions">Wood Requisitions</Link>.
                </p>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* unified QC report: one per item */}
      {item.qc && <QcSheet itemId={itemId} qc={item.qc} onChanged={after} />}

      <div className="space-y-5 no-print">
        {/* stage history */}
        {history.length > 0 && (
          <Card title="Stage history">
            <ol className="relative ml-2 space-y-4 border-l-2 border-slate-200 pl-5">
              {[...history].reverse().map((h, i) => {
                const k = h.kind ? KIND[h.kind] : undefined
                const live = !h.ended_at && i === 0 && item.stage !== 'Delivered'
                return (
                  <li key={`${h.started_at}-${i}`} className="relative">
                    <span aria-hidden className={cx('absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white', h.kind === 'rework' ? 'bg-red-500' : k ? 'bg-orange-400' : live ? 'bg-blue-600' : 'bg-brand-700')} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-brand-950">{h.stage}</span>
                      {k && <Pill tone={k.tone}>{k.label}</Pill>}
                      {live && <Pill tone="brand">Current</Pill>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {[h.started_at ? `Started ${fmtDateTime(h.started_at)}` : null,
                        h.hours !== undefined && h.hours !== null ? `${hoursLabel(h.hours)}${live ? ' so far' : ''}` : null,
                        h.user ? `by ${h.user}` : null].filter(Boolean).join(' · ')}
                    </p>
                    {h.note && <p className="mt-0.5 break-words text-sm text-slate-800">{h.note}</p>}
                  </li>
                )
              })}
            </ol>
          </Card>
        )}

        {/* cost summary for cost-permitted users */}
        {user?.can_view_cost && item.cost && (
          <Card title="Production cost" actions={<Link to={`/cost/${itemId}`}><Button variant="secondary" size="sm" icon={<Calculator className="h-4 w-4" />}>Open cost sheet</Button></Link>}>
            <Facts cols={3} items={[
              ['Total cost', money(item.cost.total ?? 0)],
              ['Cost lines', costLines ? String(costLines) : 'No cost recorded yet'],
              ['Cost sheet', item.cost.sheet_no],
            ]} />
          </Card>
        )}

        {/* role actions */}
        {hasRoleActions && (
          <Card title={isSuper ? 'Super Admin actions' : 'Production Manager actions'}>
            <div className="flex flex-wrap gap-2">
              {canReassign && <Button variant="secondary" size="lg" icon={<Shuffle className="h-4 w-4" />} onClick={() => { setSiteId(''); setReason(''); setReassignErr(''); setReassign(true) }}>Reassign site</Button>}
              {canReverse && (
                <Button variant="secondary" size="lg" icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'reverse'}
                  onClick={() => withReason('reverse', 'Reverse last stage?', `${item.item_no} will return from ${item.stage} to its previous stage. The original entry stays in the history.`, `/items/${itemId}/reverse`, 'Reverse stage')}>
                  Reverse last stage
                </Button>
              )}
              {canRemoveUph && (
                <Button variant="secondary" size="lg" icon={<Undo2 className="h-4 w-4" />} loading={busy === 'uph'}
                  onClick={() => withReason('uph', 'Remove upholstery?', 'Upholstery and Upholstery QC will no longer be required for this item.', `/items/${itemId}/remove-upholstery`, 'Remove upholstery')}>
                  Remove upholstery
                </Button>
              )}
              {canUndoWh && (
                <Button variant="secondary" size="lg" icon={<Undo2 className="h-4 w-4" />} loading={busy === 'whundo'}
                  onClick={() => withReason('whundo', 'Undo warehouse step?', `${item.item_no} will return from ${item.stage} to ${item.stage === 'Packed' ? 'In Warehouse' : 'Packed'}.`, `/items/${itemId}/warehouse/undo`, 'Undo step')}>
                  Undo warehouse step
                </Button>
              )}
              {showCostLink && <Link to={`/cost/${itemId}`}><Button variant="ghost" size="lg" icon={<Calculator className="h-4 w-4" />}>Production Cost Sheet</Button></Link>}
            </div>
          </Card>
        )}
      </div>

      {/* Finish Good: confirm final measurements */}
      <Modal open={!!finish} onClose={() => { if (busy !== 'move:Finish Good') setFinish(null) }} title="Finish Good: confirm final measurements" size="md"
        footer={<>
          <Button variant="secondary" size="lg" onClick={() => setFinish(null)} disabled={busy === 'move:Finish Good'}>Cancel</Button>
          <Button variant="success" size="lg" icon={<PackageCheck className="h-5 w-5" />} loading={busy === 'move:Finish Good'} onClick={submitFinish}>Confirm Finish Good</Button>
        </>}>
        {finish && (
          <div className="space-y-4">
            <Notice tone="info">
              {item.item_no} will be marked Finish Good and moved to the Product Warehouse. Only the Production Manager can reverse a stage update.
            </Notice>
            {(item.height || item.width || item.length) && <p className="text-sm text-slate-600">Ordered H / W / L: <span className="font-semibold text-brand-950">{dims(item.height, item.width, item.length)}</span></p>}
            <div className="grid grid-cols-3 gap-3">
              {([['h', 'Final Height'], ['w', 'Final Width'], ['l', 'Final Length']] as const).map(([k, label]) => (
                <Field key={k} label={`${label} (${unit})`} required>
                  <Input type="number" inputMode="decimal" min={0} step="any" className="!h-12 text-base" value={finish[k]}
                    onChange={(e) => { setFinish({ ...finish, [k]: e.target.value }); setFinishErr('') }} />
                </Field>
              ))}
            </div>
            <ErrorNote error={finishErr} />
          </div>
        )}
      </Modal>

      {/* requisition forms with this item fixed */}
      <Modal open={reqForm === 'store'} onClose={() => setReqForm(null)} title={`New Store Requisition · ${item.item_no}`} size="xl">
        {reqForm === 'store' && <StoreRequisitionForm itemId={itemId} onDone={reqDone} onCancel={() => setReqForm(null)} />}
      </Modal>
      <Modal open={reqForm === 'wood'} onClose={() => setReqForm(null)} title={`New Wood Requisition · ${item.item_no}`} size="lg">
        {reqForm === 'wood' && <WoodRequisitionForm itemId={itemId} onDone={reqDone} onCancel={() => setReqForm(null)} />}
      </Modal>

      {/* reassign site */}
      <Modal open={reassign} onClose={() => { if (busy !== 'assign') setReassign(false) }} title={`Reassign ${item.item_no}`} size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setReassign(false)} disabled={busy === 'assign'}>Cancel</Button>
          <Button icon={<MapPin className="h-4 w-4" />} loading={busy === 'assign'} onClick={submitReassign}>Reassign</Button>
        </>}>
        {sites.loading ? <Spinner /> : sites.error ? <ErrorNote error={sites.error} /> : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Current site: <span className="font-semibold text-brand-950">{item.site}{item.apm ? ` · ${item.apm}` : ''}</span></p>
            <Field label="New site" required>
              <Select value={siteId} onChange={(e) => { setSiteId(e.target.value); setReassignErr('') }}>
                <option value="">Select an active site…</option>
                {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.apm ? ` (${s.apm})` : ' (no APM)'}</option>)}
              </Select>
            </Field>
            {isSuper && (
              <Field label="Reason" required>
                <Textarea value={reason} onChange={(e) => { setReason(e.target.value); setReassignErr('') }} />
              </Field>
            )}
            <ErrorNote error={reassignErr} />
          </div>
        )}
      </Modal>
    </div>
  )
}
