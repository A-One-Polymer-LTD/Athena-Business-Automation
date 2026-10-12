// Unified QC report: ONE sheet per item, laid out like the familiar paper QC sheet (Workflow F).
import { Camera, CheckCircle2, PenLine, Printer, RotateCcw, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtDateTime } from '../lib/format'
import { AuthImage, ImageStrip } from './AuthImage'
import { Button, ErrorNote, Field, Modal, Notice, Pill, Textarea, cx, errText, useUi } from './ui'

export interface QcLine { id: number; result: string; checker?: string; at?: string; note?: string; photo?: string }
export interface QcCheck { label: string; stage: string; latest?: string | null; history: QcLine[]; can_record?: boolean }
export interface QcReport {
  qc_ref: string
  created_at?: string
  order_no?: string
  item_no?: string
  customer?: string
  product_name?: string
  design?: string
  wood_category?: string
  seasoning?: string
  carpenter_side?: string
  remarks?: string
  site?: string
  apm?: string
  upholstery?: boolean
  checks: Record<string, QcCheck>
  rework_count?: number
  apm_signed_by?: string
  apm_signed_at?: string
  pm_signed_by?: string
  pm_signed_at?: string
}

const CARP = ['carp_before', 'carp_final'] as const
const LACQ = ['lacq_before', 'lacq_final'] as const
const SHORT: Record<string, string> = {
  carp_before: 'Before carp. fitting QC', carp_final: 'Final carp. fitting QC',
  lacq_before: 'Before colour QC', lacq_final: 'Final colour QC', upholstery: 'Upholstery QC',
}

const TH_BASE = 'px-2.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide align-middle'
const TD_BASE = 'px-2.5 py-2.5 text-center align-middle text-[13px]'
const LINE = 'border border-slate-300'
/** the optional Upholstery group: orange tint with a dashed border */
const UPH = 'border-2 border-dashed border-orange-400'
const TH = `${LINE} ${TH_BASE}`
const TD = `${LINE} ${TD_BASE}`

function ResultText({ result }: { result?: string | null }) {
  if (result === 'Pass') return <span className="font-bold text-emerald-700">Pass</span>
  if (result === 'Rework') return <span className="font-bold text-red-600">Rework</span>
  return <span className="text-slate-400">—</span>
}

/**
 * The unified QC sheet of one item. APMs record results in the cells that are open for their stage,
 * edit Carpenter working side and Remarks, and sign off; the Production Manager signs off.
 */
export default function QcSheet({ itemId, qc, onChanged }: { itemId: number; qc: QcReport; onChanged: () => void }) {
  const { user } = useAuth()
  const { toast, confirm } = useUi()
  const isApm = user?.role === 'Assistant Production Manager'
  const isPm = user?.role === 'Production Manager'

  const [side, setSide] = useState(qc.carpenter_side ?? '')
  const [remarks, setRemarks] = useState(qc.remarks ?? '')
  const [saving, setSaving] = useState(false)
  const [signing, setSigning] = useState(false)
  useEffect(() => { setSide(qc.carpenter_side ?? ''); setRemarks(qc.remarks ?? '') }, [qc.carpenter_side, qc.remarks])
  const dirty = side.trim() !== (qc.carpenter_side ?? '') || remarks.trim() !== (qc.remarks ?? '')

  // record a result
  const [recKey, setRecKey] = useState<string | null>(null)
  const [result, setResult] = useState<'Pass' | 'Rework' | null>(null)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState('')
  const [uploading, setUploading] = useState(false)
  const [recError, setRecError] = useState('')
  const [recording, setRecording] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const checks = qc.checks ?? {}
  const hasUph = !!checks.upholstery
  const keys = [...CARP, ...LACQ, ...(hasUph ? ['upholstery'] : [])].filter((k) => checks[k])
  const allPass = keys.length > 0 && keys.every((k) => checks[k].latest === 'Pass')
  const pending = keys.filter((k) => checks[k].latest !== 'Pass').map((k) => checks[k].label)
  const anyHistory = keys.some((k) => checks[k].history?.length)

  const openRecord = (key: string) => { setRecKey(key); setResult(null); setNote(''); setPhoto(''); setRecError('') }
  const closeRecord = () => { if (!recording) setRecKey(null) }

  const pickPhoto = async (file?: File) => {
    if (!file) return
    setUploading(true)
    setRecError('')
    try { setPhoto((await api.upload(file)).file) } catch (e) { setRecError(errText(e)) } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveResult = async () => {
    if (!recKey || recording) return
    if (!result) { setRecError('Please choose Pass or Rework.'); return }
    if (result === 'Rework' && !note.trim()) { setRecError('Please enter a defect note for the rework.'); return }
    setRecording(true)
    setRecError('')
    try {
      const res = await api.post<{ message: string }>(`/items/${itemId}/qc/result`, { check: recKey, result, note: note.trim(), photo: photo || null })
      if (result === 'Rework') toast.warn(res.message)
      else toast.success(res.message)
      setRecKey(null)
      onChanged()
    } catch (e) {
      setRecError(errText(e))
      toast.error(errText(e))
    } finally { setRecording(false) }
  }

  const saveDetails = async () => {
    setSaving(true)
    try {
      const res = await api.put<{ message: string }>(`/items/${itemId}/qc`, { carpenter_side: side.trim(), remarks: remarks.trim() })
      toast.success(res.message)
      onChanged()
    } catch (e) { toast.error(errText(e)) } finally { setSaving(false) }
  }

  const sign = async () => {
    const ok = await confirm({
      title: 'Sign off this QC report?',
      message: `Your name and the time will be recorded on ${qc.qc_ref}. A sign-off cannot be withdrawn.`,
      confirmLabel: 'Sign off', tone: 'success',
    })
    if (!ok) return
    setSigning(true)
    try {
      const res = await api.post<{ message: string }>(`/items/${itemId}/qc/sign`)
      toast.success(res.message)
      onChanged()
    } catch (e) { toast.error(errText(e)) } finally { setSigning(false) }
  }

  const qcCell = (key: string, tint: string, uph = false) => {
    const base = uph ? `${TD_BASE} ${UPH}` : TD
    const c = checks[key]
    if (!c) return <td key={key} className={cx(base, tint)}><span className="text-slate-400">—</span></td>
    const open = isApm && !!c.can_record
    return (
      <td key={key} className={cx(base, tint, open && '!p-1')}>
        {open ? (
          <button type="button" onClick={() => openRecord(key)} aria-label={`Record ${c.label}`}
            className="flex min-h-[52px] w-full min-w-[104px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-brand-400 bg-white px-2 py-1.5 transition hover:border-brand-600 hover:bg-brand-50">
            <ResultText result={c.latest} />
            <span className="text-[11px] font-semibold text-brand-700 no-print">{c.latest ? 'Tap to record again' : 'Tap to record'}</span>
          </button>
        ) : <ResultText result={c.latest} />}
      </td>
    )
  }

  const rec = recKey ? checks[recKey] : null

  return (
    <section className="print-area rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-bold text-brand-950">Unified QC Report</h2>
          <p className="text-xs text-slate-500">One report for this item, covering every QC check.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(qc.rework_count ?? 0) > 0 && <Pill tone="red">Rework × {qc.rework_count}</Pill>}
          <Button variant="secondary" size="sm" className="no-print" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <div className="p-5">
        {/* header line of the paper sheet */}
        <div className="mb-3 flex flex-wrap gap-x-8 gap-y-1.5 text-sm">
          {([['QC Ref No.', qc.qc_ref], ['Date', qc.created_at ? fmtDate(qc.created_at) : null], ['Order No.', qc.order_no], ['Item No.', qc.item_no], ['Site', qc.site], ['APM', qc.apm]] as [string, string | null | undefined][])
            .filter(([, v]) => v).map(([k, v]) => (
              <p key={k}><span className="text-slate-500">{k}: </span><span className="font-bold text-brand-950">{v}</span></p>
            ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-700">
                <th rowSpan={2} className={TH}>Order No</th>
                <th rowSpan={2} className={TH}>Customer Name</th>
                <th rowSpan={2} className={TH}>Product Name</th>
                <th rowSpan={2} className={TH}>Design</th>
                <th rowSpan={2} className={TH}>Kind of Wood</th>
                <th rowSpan={2} className={TH}>Seasoning Status</th>
                <th colSpan={3} className={cx(TH, 'bg-emerald-100 text-emerald-900')}>Carpenter QC</th>
                <th colSpan={2} className={cx(TH, 'bg-blue-100 text-blue-900')}>Lacquer QC</th>
                {hasUph && <th className={cx(TH_BASE, UPH, 'bg-orange-100 text-orange-900')}>Upholstery</th>}
                <th rowSpan={2} className={TH}>Remarks</th>
              </tr>
              <tr className="text-slate-700">
                <th className={cx(TH, 'bg-emerald-50')}>Carpenter working side</th>
                {CARP.map((k) => <th key={k} className={cx(TH, 'bg-emerald-50')}>{SHORT[k]}</th>)}
                {LACQ.map((k) => <th key={k} className={cx(TH, 'bg-blue-50')}>{SHORT[k]}</th>)}
                {hasUph && <th className={cx(TH_BASE, UPH, 'bg-orange-50')}>{SHORT.upholstery}</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cx(TD, 'whitespace-nowrap font-semibold text-brand-950')}>{qc.order_no ?? '—'}</td>
                <td className={TD}>{qc.customer ?? '—'}</td>
                <td className={TD}>{qc.product_name ?? '—'}</td>
                <td className={cx(TD, 'max-w-[200px] text-left')}>{qc.design ?? '—'}</td>
                <td className={TD}>{qc.wood_category ?? '—'}</td>
                <td className={TD}>{qc.seasoning ?? '—'}</td>
                <td className={cx(TD, 'bg-emerald-50/50', isApm && '!p-1')}>
                  {isApm ? (
                    <input aria-label="Carpenter working side" value={side} maxLength={150} onChange={(e) => setSide(e.target.value)} placeholder="Enter…"
                      className="h-11 w-full min-w-[130px] rounded-md border border-slate-300 bg-white px-2 text-center text-[13px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  ) : (qc.carpenter_side ?? <span className="text-slate-400">—</span>)}
                </td>
                {CARP.map((k) => qcCell(k, 'bg-emerald-50/50'))}
                {LACQ.map((k) => qcCell(k, 'bg-blue-50/50'))}
                {hasUph && qcCell('upholstery', 'bg-orange-50/50', true)}
                <td className={cx(TD, 'text-left', isApm && '!p-1')}>
                  {isApm ? (
                    <textarea aria-label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Enter…"
                      className="block w-full min-w-[170px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  ) : (qc.remarks ?? <span className="text-slate-400">—</span>)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {isApm && (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-3 no-print">
            {dirty && <span className="text-xs font-medium text-orange-700">Carpenter working side or Remarks changed. Save to keep the change.</span>}
            <Button variant={dirty ? 'primary' : 'secondary'} icon={<Save className="h-4 w-4" />} loading={saving} disabled={!dirty} onClick={saveDetails}>Save</Button>
          </div>
        )}

        {/* full history of every check: a Rework and the later Pass both stay visible */}
        {anyHistory && (
          <div className="mt-6">
            <p className="mb-3 border-l-4 border-gold-400 pl-3 text-[13px] font-bold uppercase tracking-wider text-brand-900">QC history</p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {keys.filter((k) => checks[k].history?.length).map((k) => (
                <div key={k} className="print-break-avoid rounded-lg border border-slate-200 p-3">
                  <p className="mb-2 text-sm font-bold text-brand-950">{checks[k].label}</p>
                  <ol className="space-y-2">
                    {checks[k].history.map((h, i) => (
                      <li key={h.id} className={cx('flex gap-3 rounded-lg border px-3 py-2', h.result === 'Rework' ? 'border-red-200 bg-red-50/60' : 'border-emerald-200 bg-emerald-50/50')}>
                        <span className="tabular mt-0.5 text-xs font-semibold text-slate-500">{i + 1}.</span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p><ResultText result={h.result} />
                            <span className="text-slate-600">{h.checker ? ` · ${h.checker}` : ''}{h.at ? ` · ${fmtDateTime(h.at)}` : ''}</span>
                          </p>
                          {h.note && <p className="mt-0.5 break-words text-slate-800">{h.note}</p>}
                        </div>
                        {h.photo && <div className="shrink-0"><ImageStrip images={[h.photo]} size="h-14 w-16" /></div>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* sign-off block */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 print-break-avoid">
          {([
            { who: 'APM', by: qc.apm_signed_by, at: qc.apm_signed_at, mine: isApm },
            { who: 'Production Manager', by: qc.pm_signed_by, at: qc.pm_signed_at, mine: isPm },
          ]).map((s) => (
            <div key={s.who} className={cx('rounded-lg border px-4 py-3', s.by ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-slate-50')}>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{s.who} sign-off</p>
              {s.by ? (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> Signed by {s.by}{s.at ? <span className="font-medium text-slate-600">· {fmtDateTime(s.at)}</span> : null}
                </p>
              ) : <p className="mt-1 text-sm font-medium text-slate-500">Not signed yet</p>}
              {s.mine && !s.by && (
                <div className="mt-3 no-print">
                  <Button variant="success" size="lg" icon={<PenLine className="h-4 w-4" />} loading={signing} disabled={!allPass} onClick={sign}>Sign off</Button>
                  {!allPass && <p className="mt-1.5 text-xs font-medium text-slate-600">Sign-off opens when every required check is Pass. Still open: {pending.join(', ')}.</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Modal open={!!rec} onClose={closeRecord} title={rec ? `Record ${rec.label}` : ''} size="sm"
        footer={<>
          <Button variant="secondary" size="lg" onClick={closeRecord} disabled={recording}>Cancel</Button>
          <Button size="lg" variant={result === 'Rework' ? 'danger' : 'success'} loading={recording} disabled={uploading} onClick={saveResult}>
            {result === 'Rework' ? 'Record Rework' : result === 'Pass' ? 'Record Pass' : 'Record result'}
          </Button>
        </>}>
        {rec && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Result">
              <button type="button" role="radio" aria-checked={result === 'Pass'} onClick={() => { setResult('Pass'); setRecError('') }}
                className={cx('flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition', result === 'Pass' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50')}>
                <CheckCircle2 className="h-5 w-5" /> Pass
              </button>
              <button type="button" role="radio" aria-checked={result === 'Rework'} onClick={() => { setResult('Rework'); setRecError('') }}
                className={cx('flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition', result === 'Rework' ? 'border-red-600 bg-red-600 text-white' : 'border-red-300 bg-white text-red-600 hover:bg-red-50')}>
                <RotateCcw className="h-5 w-5" /> Rework
              </button>
            </div>
            {result === 'Rework' && (
              <Notice tone="warn">Rework sends the item back to the making stage. This result stays in the QC history.</Notice>
            )}
            <Field label={result === 'Rework' ? 'Defect note' : 'Note'} required={result === 'Rework'}>
              <Textarea value={note} maxLength={500} onChange={(e) => { setNote(e.target.value); setRecError('') }} placeholder={result === 'Rework' ? 'What must be corrected?' : 'Optional'} />
            </Field>
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Photo (optional)</span>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
              {photo ? (
                <div className="flex items-center gap-3">
                  <AuthImage file={photo} alt="QC photo" className="h-20 w-24 rounded-lg border border-slate-200" />
                  <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => setPhoto('')}>Remove</Button>
                </div>
              ) : (
                <Button variant="secondary" size="lg" icon={<Camera className="h-5 w-5" />} loading={uploading} onClick={() => fileRef.current?.click()}>Add photo</Button>
              )}
            </div>
            <ErrorNote error={recError} />
          </div>
        )}
      </Modal>
    </section>
  )
}
