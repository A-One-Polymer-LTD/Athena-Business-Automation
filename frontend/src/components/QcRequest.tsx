// QC requests (Workflow F): send an item to a QC stage for a named reviewer, track every stage, and let the
// reviewer approve or reject. Shared by the item screen and the QC Requests inbox.
import { ArrowRight, Camera, CheckCircle2, Clock, Send, UserRound, Users, X, XCircle } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { fmtDateTime, hoursLabel } from '../lib/format'
import { AuthImage } from './AuthImage'
import { Button, ErrorNote, Field, Modal, Notice, Select, Spinner, StatusBadge, Textarea, cx, errText, useLoad, useUi } from './ui'

export interface QcRequest {
  id: number
  request_no: string
  stage: string
  round: number
  status: 'Pending' | 'Approved' | 'Rejected' | 'Withdrawn'
  submitted_by: string
  submitted_at: string
  note?: string
  reviewer: string
  decided_by?: string
  decided_at?: string
  feedback?: string
  results?: { check: string; result: string; by: string; at: string; note?: string; photo?: string }[]
  reassignments?: { from: string; to: string; by: string; at: string; reason?: string }[]
  waiting_hours?: number
  checks?: string[]
  open_checks?: string[]
  next_action?: string
  can_review?: boolean
  can_reassign?: boolean
  // inbox rows also carry the item
  item_id?: number
  item_no?: string
  order_no?: string
  customer?: string
  product_name?: string
  product_code?: string
  site?: string
  apm?: string
  item_stage?: string
  qc_ref?: string
}
export interface QcStageTrack { stage: string; status: string; making_stage: string; passed?: boolean; requests: QcRequest[] }
interface Reviewer { id: number; name: string; role: string; hint?: string }

/** check label -> key used by the API */
export const CHECK_KEY: Record<string, string> = {
  'Before Carpenter Fitting QC': 'carp_before', 'Final Carpenter Fitting QC': 'carp_final',
  'Before Colour QC': 'lacq_before', 'Final Colour QC': 'lacq_final', 'Upholstery QC': 'upholstery',
}
export const QC_STAGES = ['Carpenter QC', 'Lacquer QC', 'Upholstery QC']

/** Send to Carpenter / Lacquer / Upholstery QC: the sender chooses who reviews it (the site's APM by default). */
export function SendToQcModal({ itemId, itemNo, stage, label, onClose, onSent }: {
  itemId: number; itemNo: string; stage: string | null; label?: string; onClose: () => void; onSent: (message: string, warnings?: string[]) => void
}) {
  const reviewers = useLoad<Reviewer[]>(() => (stage ? api.get(`/items/${itemId}/qc-reviewers`) : Promise.resolve([])), [stage, itemId])
  const [reviewer, setReviewer] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = reviewers.data ?? []
  const chosen = reviewer || (list[0] ? String(list[0].id) : '')
  const who = list.find((r) => String(r.id) === chosen)

  const send = async () => {
    if (!chosen) { setErr('Please choose who will review this QC.'); return }
    setBusy(true); setErr('')
    try {
      const res: any = await api.post(`/items/${itemId}/move`, { to: stage, reviewer_id: Number(chosen), note: note.trim() || undefined })
      setNote(''); setReviewer('')
      onSent(res.message, res.warnings)
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={!!stage} onClose={() => { if (!busy) onClose() }} title={`${label ?? `Send to ${stage}`} · ${itemNo}`} size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button icon={<Send className="h-4 w-4" />} loading={busy} onClick={send} disabled={!chosen}>Send QC request</Button>
      </>}>
      {reviewers.loading ? <Spinner /> : reviewers.error ? <ErrorNote error={reviewers.error} /> : (
        <div className="space-y-4">
          <Notice>
            A <span className="font-semibold">QC request</span> for {stage} goes to the reviewer you choose. They approve it (every check Pass) or
            reject it (Rework, with feedback). You can follow it in QC Requests and on this item.
          </Notice>
          <Field label="Send to (QC reviewer)" required hint={who ? `${who.role}${who.hint ? ` · ${who.hint}` : ''}` : undefined}>
            <Select value={chosen} onChange={(e) => { setReviewer(e.target.value); setErr('') }} aria-label="QC reviewer">
              {list.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.role === 'Assistant Production Manager' ? 'APM' : r.role}{r.hint ? ` (${r.hint})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Note for the reviewer (optional)">
            <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: drawer fitting re-done after the last check" />
          </Field>
          <ErrorNote error={err} />
        </div>
      )}
    </Modal>
  )
}

/** A pending request is shown as "In review" (amber), everywhere. */
export function RequestStatus({ status }: { status: string }) {
  return status === 'Pending'
    ? <StatusBadge status="In review" className="!bg-amber-100 !text-amber-800" />
    : <StatusBadge status={status} />
}

const ICON: Record<string, ReactNode> = {
  Pending: <Clock className="h-4 w-4 text-amber-600" />,
  Approved: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  Rejected: <XCircle className="h-4 w-4 text-red-600" />,
}

/** One line per request: who sent it to whom, and what happened. */
function RequestLine({ r }: { r: QcRequest }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-brand-950">{r.request_no}</span>
        {r.round > 1 && <span className="text-xs font-semibold text-slate-500">Round {r.round}</span>}
        <RequestStatus status={r.status} />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">{r.submitted_by}</span> sent to <span className="font-semibold text-slate-800">{r.reviewer}</span> · {fmtDateTime(r.submitted_at)}
      </p>
      {r.note && <p className="mt-0.5 text-xs text-slate-700">Note: {r.note}</p>}
      {(r.reassignments ?? []).map((x, i) => (
        <p key={i} className="mt-0.5 text-xs text-slate-500">Reassigned from {x.from} to {x.to} by {x.by} · {fmtDateTime(x.at)}{x.reason ? ` · ${x.reason}` : ''}</p>
      ))}
      {r.decided_by && r.status !== 'Withdrawn' && (
        <p className={cx('mt-0.5 text-xs font-medium', r.status === 'Rejected' ? 'text-red-700' : 'text-emerald-700')}>
          {r.status} by {r.decided_by} · {r.decided_at ? fmtDateTime(r.decided_at) : ''}{r.feedback ? ` · ${r.feedback}` : ''}
        </p>
      )}
      {r.status === 'Withdrawn' && r.feedback && <p className="mt-0.5 text-xs text-slate-500">{r.feedback}</p>}
      {r.next_action && r.status !== 'Withdrawn' && <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-800"><ArrowRight className="h-3.5 w-3.5" />{r.next_action}</p>}
    </li>
  )
}

/** Carpenter QC → Lacquer QC → (Upholstery QC): status of each stage and every request round. */
export function QcTracker({ tracker, title = 'QC tracking' }: { tracker: QcStageTrack[]; title?: string }) {
  if (!tracker?.length) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-card" aria-label={title}>
      <header className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-[15px] font-bold text-brand-950">{title}</h2>
        <p className="text-xs text-slate-500">Each QC stage is sent to a reviewer, who approves it or rejects it for rework. A rework sends the item back to the stage that made it; it is then sent again as a new round.</p>
      </header>
      <div className="grid gap-4 p-5 lg:grid-cols-3">
        {tracker.map((t, i) => {
          const latest = t.requests[t.requests.length - 1]
          return (
            <div key={t.stage} className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  t.status === 'Approved' ? 'bg-emerald-600 text-white' : t.status === 'Rejected' ? 'bg-red-600 text-white' : t.status === 'Pending' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500')}>
                  {i + 1}
                </span>
                <span className="text-sm font-bold text-brand-950">{t.stage}</span>
                <RequestStatus status={t.status} />
              </div>
              {latest?.status === 'Pending' && (
                <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">{ICON.Pending}With {latest.reviewer} for {hoursLabel(latest.waiting_hours ?? 0)}</p>
              )}
              {t.requests.length ? (
                <ol className="space-y-2">{[...t.requests].reverse().map((r) => <RequestLine key={r.id} r={r} />)}</ol>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">
                  {t.status === 'Approved' ? 'Passed before QC requests were recorded.' : `Starts when ${t.making_stage} is done and the item is sent to ${t.stage}.`}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The reviewer's panel: request details, Approve / Reject, and Reassign. */
export function QcReviewPanel({ req, itemId, onChanged }: { req: QcRequest; itemId: number; onChanged: () => void }) {
  const { toast } = useUi()
  const [mode, setMode] = useState<'approve' | 'reject' | 'reassign' | null>(null)
  const [note, setNote] = useState('')
  const [check, setCheck] = useState('')
  const [photo, setPhoto] = useState('')
  const [uploading, setUploading] = useState(false)
  const [reviewer, setReviewer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const reviewers = useLoad<Reviewer[]>(() => (mode === 'reassign' ? api.get(`/items/${itemId}/qc-reviewers`) : Promise.resolve([])), [mode, itemId])
  const openChecks = req.open_checks ?? []

  const start = (m: typeof mode) => { setMode(m); setNote(''); setCheck(openChecks[openChecks.length - 1] ?? ''); setPhoto(''); setReviewer(''); setErr('') }
  const pickPhoto = async (file?: File) => {
    if (!file) return
    setUploading(true); setErr('')
    try { setPhoto((await api.upload(file)).file) } catch (e) { setErr(errText(e)) } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const submit = async () => {
    setErr('')
    if (mode === 'reject' && !check) { setErr('Please choose the check that failed.'); return }
    if (mode === 'reject' && !note.trim()) { setErr('Please enter feedback: what must be reworked.'); return }
    if (mode === 'reassign' && !reviewer) { setErr('Please choose the new reviewer.'); return }
    setBusy(true)
    try {
      const path = `/qc-requests/${req.id}/${mode}`
      const body = mode === 'approve' ? { note: note.trim() || undefined }
        : mode === 'reject' ? { check: CHECK_KEY[check], note: note.trim(), photo: photo || null }
          : { reviewer_id: Number(reviewer), reason: note.trim() || undefined }
      const res: any = await api.post(path, body)
      if (mode === 'reject') toast.warn(res.message); else toast.success(res.message)
      setMode(null)
      onChanged()
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }

  const steps = [
    { label: 'Submitted', sub: `${req.submitted_by} · ${fmtDateTime(req.submitted_at)}`, done: true },
    { label: 'In review', sub: req.reviewer, done: req.status !== 'Pending', current: req.status === 'Pending' },
    { label: req.status === 'Pending' ? 'Decision' : req.status, sub: req.decided_by ? `${req.decided_by}${req.decided_at ? ` · ${fmtDateTime(req.decided_at)}` : ''}` : 'Waiting for the decision', done: req.status !== 'Pending', bad: req.status === 'Rejected' },
  ]

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-card" aria-label={`QC request ${req.request_no}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-brand-950">{req.request_no}</h2>
            <RequestStatus status={req.status} />
            <span className="text-sm font-semibold text-slate-700">{req.stage}{req.round > 1 ? ` · Round ${req.round}` : ''}</span>
          </div>
          <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
            <UserRound className="h-4 w-4 text-slate-400" /><span className="font-semibold">{req.submitted_by}</span>
            <ArrowRight className="h-4 w-4 text-slate-400" /><Users className="h-4 w-4 text-slate-400" /><span className="font-semibold">{req.reviewer}</span>
            <span className="text-slate-500">· {req.status === 'Pending' ? 'waiting' : 'decided after'} {hoursLabel(req.waiting_hours ?? 0)}</span>
          </p>
        </div>
        {req.status === 'Pending' && (
          <div className="flex flex-wrap gap-2">
            {req.can_review && <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => start('approve')}>Approve</Button>}
            {req.can_review && <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => start('reject')}>Reject (Rework)</Button>}
            {req.can_reassign && <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => start('reassign')}>Reassign</Button>}
          </div>
        )}
      </header>
      <div className="space-y-4 px-5 py-4">
        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((s) => (
            <li key={s.label} className={cx('rounded-lg border px-3 py-2', s.bad ? 'border-red-200 bg-red-50' : s.current ? 'border-amber-300 bg-amber-50' : s.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
              <p className={cx('text-xs font-bold uppercase tracking-wide', s.bad ? 'text-red-700' : s.current ? 'text-amber-800' : s.done ? 'text-emerald-800' : 'text-slate-500')}>{s.label}</p>
              <p className="mt-0.5 text-xs text-slate-700">{s.sub}</p>
            </li>
          ))}
        </ol>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold text-slate-500">Checks in this stage</dt><dd className="text-slate-800">{(req.checks ?? []).join(', ')}</dd></div>
          {req.status === 'Pending' && <div><dt className="text-xs font-semibold text-slate-500">Still to pass</dt><dd className="font-semibold text-amber-800">{openChecks.join(', ') || 'None'}</dd></div>}
          {req.note && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Note from {req.submitted_by}</dt><dd className="text-slate-800">{req.note}</dd></div>}
          {req.feedback && req.status !== 'Pending' && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Reviewer feedback</dt><dd className={req.status === 'Rejected' ? 'font-medium text-red-700' : 'text-slate-800'}>{req.feedback}</dd></div>}
          {req.next_action && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Next action</dt><dd className="font-semibold text-brand-800">{req.next_action}</dd></div>}
        </dl>
        {req.status === 'Pending' && !req.can_review && (
          <Notice>Only <span className="font-semibold">{req.reviewer}</span> can approve or reject this request.{req.can_reassign ? ' You can reassign it to another reviewer.' : ''}</Notice>
        )}
      </div>

      <Modal open={!!mode} onClose={() => { if (!busy) setMode(null) }} size="md"
        title={mode === 'approve' ? `Approve ${req.request_no}` : mode === 'reject' ? `Reject ${req.request_no}` : `Reassign ${req.request_no}`}
        footer={<>
          <Button variant="secondary" onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
          <Button variant={mode === 'approve' ? 'success' : mode === 'reject' ? 'danger' : 'primary'} loading={busy} disabled={uploading} onClick={submit}>
            {mode === 'approve' ? 'Approve' : mode === 'reject' ? 'Reject for rework' : 'Reassign'}
          </Button>
        </>}>
        <div className="space-y-4">
          {mode === 'approve' && <Notice tone="success">{openChecks.length ? `${openChecks.join(' and ')} will be recorded as Pass.` : 'Every check of this stage will be recorded as Pass.'} The APM can then move the item to the next stage.</Notice>}
          {mode === 'reject' && (
            <>
              <Notice tone="warn">The failed check is recorded as Rework and the item goes back to {req.stage.replace(' QC', '')} for rework. It comes back to you as a new round.</Notice>
              <Field label="Check that failed" required>
                <Select value={check} onChange={(e) => setCheck(e.target.value)}>
                  {(openChecks.length ? openChecks : req.checks ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </>
          )}
          {mode === 'reassign' && (reviewers.loading ? <Spinner /> : (
            <Field label="New reviewer" required>
              <Select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                <option value="">Choose a reviewer…</option>
                {(reviewers.data ?? []).filter((r) => r.name !== req.reviewer).map((r) => <option key={r.id} value={r.id}>{r.name} · {r.role === 'Assistant Production Manager' ? 'APM' : r.role}{r.hint ? ` (${r.hint})` : ''}</option>)}
              </Select>
            </Field>
          ))}
          <Field label={mode === 'reject' ? 'Feedback: what must be reworked' : mode === 'reassign' ? 'Reason (optional)' : 'Comment (optional)'} required={mode === 'reject'}>
            <Textarea value={note} maxLength={500} onChange={(e) => { setNote(e.target.value); setErr('') }} />
          </Field>
          {mode === 'reject' && (
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Photo (optional)</p>
              <div className="flex items-center gap-3">
                {photo && (
                  <div className="relative">
                    <AuthImage file={photo} alt="Defect photo" className="h-16 w-20 rounded-lg border border-slate-200" />
                    <button type="button" aria-label="Remove photo" onClick={() => setPhoto('')} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white"><X className="h-3 w-3" /></button>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
                <Button variant="secondary" size="sm" icon={<Camera className="h-4 w-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>{photo ? 'Change photo' : 'Add photo'}</Button>
              </div>
            </div>
          )}
          <ErrorNote error={err} />
        </div>
      </Modal>
    </section>
  )
}
