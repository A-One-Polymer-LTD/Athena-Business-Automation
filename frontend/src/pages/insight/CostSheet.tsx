// P5 Production Cost Sheet (Workflow H): cost lines of one item (BR-15 to BR-17).
import { ArrowLeft, Ban, Download, Pencil, Plus, Printer } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Button, Card, Empty, ErrorNote, Facts, Field, Input, Modal, Notice, PageHeader, Pill, Select, Spinner, StatusBadge, Textarea, cx, errText, useLoad, useUi,
} from '../../components/ui'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { exportRows } from '../../lib/export'
import { fmtDate, fmtDateTime, money, num } from '../../lib/format'

interface CostLine {
  id: number; name: string; material_code?: string; rate: number; per: string; amount: number; entered_by?: string; entered_at?: string
  voided?: boolean; void_reason?: string; voided_by?: string; voided_at?: string
  history?: { name: string; rate: number; per: string; amount: number; changed_by?: string; changed_at?: string; reason?: string }[]
}
interface Sheet {
  id: number; item_no: string; order_no: string; order_id: number; customer?: string; product_name?: string; product_code?: string; category?: string
  site?: string; stage?: string; status?: string; amount?: number; order_date?: string; delivery_date?: string
  sheet_no?: string; total: number; lines?: CostLine[]; can_edit: boolean; delivered: boolean; order_total_cost: number
}
interface Material { code: string; name: string }
interface FormState { name: string; rate: string; per: string; amount: string; reason: string }
type Errs = Partial<Record<'name' | 'rate' | 'per' | 'amount' | 'reason', string>>

const DELIVERED_MSG = 'This item is delivered. Please give a reason; a new Production Report revision will be created.'
const EMPTY: FormState = { name: '', rate: '', per: '', amount: '', reason: '' }
const matLabel = (m: Material) => `${m.name} (${m.code})`

/** Shared add / edit form. `Amount` is entered directly and never calculated from the rate. */
function LineForm({ itemId, line, materials, delivered, onSaved, onCancel }: {
  itemId: number; line?: CostLine; materials: Material[]; delivered: boolean; onSaved: () => void; onCancel?: () => void
}) {
  const { toast, confirm } = useUi()
  const initialName = line ? (line.material_code ? `${line.name} (${line.material_code})` : line.name) : ''
  const [form, setForm] = useState<FormState>(line ? { name: initialName, rate: String(line.rate), per: line.per, amount: String(line.amount), reason: '' } : EMPTY)
  const [errs, setErrs] = useState<Errs>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const listId = `materials-${line?.id ?? 'new'}`
  const set = (k: keyof FormState, v: string) => { setForm((f) => ({ ...f, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })) }

  /** A value picked from the list sets the material code; anything else is a free-text expense. */
  const resolve = (text: string): { name: string; material_code: string | null } => {
    const t = text.trim()
    const m = materials.find((x) => matLabel(x).toLowerCase() === t.toLowerCase())
    if (m) return { name: m.name, material_code: m.code }
    if (line && t === initialName) return { name: line.name, material_code: line.material_code ?? null }
    return { name: t, material_code: null }
  }
  const picked = materials.find((x) => matLabel(x).toLowerCase() === form.name.trim().toLowerCase())

  const send = async (confirmDuplicate: boolean): Promise<void> => {
    const body = {
      ...resolve(form.name), rate: form.rate.trim() === '' ? null : Number(form.rate), per: form.per || null,
      amount: form.amount.trim() === '' ? null : Number(form.amount), reason: form.reason.trim() || undefined,
      confirm_duplicate: confirmDuplicate || undefined,
    }
    try {
      const res = line ? await api.put(`/cost/lines/${line.id}`, body) : await api.post(`/cost/items/${itemId}/lines`, body)
      toast.success(res.message)
      if (!line) setForm(EMPTY)
      onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate') {
        const ok = await confirm({ title: 'Possible duplicate line', message: e.message, confirmLabel: 'Save anyway', tone: 'warn' })
        if (ok) return send(true)
      } else if (e instanceof ApiError && e.code === 'reason_required') {
        setErrs((x) => ({ ...x, reason: e.message }))
      } else if (e instanceof ApiError && e.fields) {
        setErrs(e.fields as Errs)
        setFormError(e.message)
      } else setFormError(errText(e))
    }
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setFormError('')
    const local: Errs = {}
    if (!form.name.trim()) local.name = 'Please enter Name of the Item.'
    if (form.rate.trim() === '') local.rate = 'Please enter Rate.'
    else if (!(Number(form.rate) > 0)) local.rate = 'Rate must be greater than 0.'
    if (!form.per) local.per = 'Please select Per (Pcs or Set).'
    if (form.amount.trim() === '') local.amount = 'Please enter Amount.'
    else if (!(Number(form.amount) > 0)) local.amount = 'Amount must be greater than 0.'
    if (delivered && !form.reason.trim()) local.reason = DELIVERED_MSG
    setErrs(local)
    if (Object.keys(local).length) return
    setSaving(true)
    try { await send(false) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} noValidate>
      {formError && <ErrorNote error={formError} className="mb-3" />}
      <div className={cx('grid grid-cols-1 gap-3 sm:grid-cols-2', !line && 'lg:grid-cols-12')}>
        <Field label="Name of the Item" required error={errs.name} className={cx('sm:col-span-2', !line && 'lg:col-span-5')}
          hint={picked ? `Material code ${picked.code}` : 'Pick a material from the list, or type any other expense (labour, transport…)'}>
          <Input list={listId} value={form.name} invalid={!!errs.name} maxLength={170} autoComplete="off" placeholder="Start typing a material name or code"
            onChange={(e) => set('name', e.target.value)} />
          <datalist id={listId}>{materials.map((m) => <option key={m.code} value={matLabel(m)} />)}</datalist>
        </Field>
        <Field label="Rate" required error={errs.rate} className={cx(!line && 'lg:col-span-2')}>
          <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.rate} invalid={!!errs.rate} placeholder="0.00" onChange={(e) => set('rate', e.target.value)} />
        </Field>
        <Field label="Per" required error={errs.per} className={cx(!line && 'lg:col-span-2')}>
          <Select value={form.per} invalid={!!errs.per} onChange={(e) => set('per', e.target.value)}>
            <option value="">Select…</option><option value="Pcs">Pcs</option><option value="Set">Set</option>
          </Select>
        </Field>
        <Field label="Amount" required error={errs.amount} className={cx(!line && 'lg:col-span-3')}>
          <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} invalid={!!errs.amount} placeholder="0.00" onChange={(e) => set('amount', e.target.value)} />
        </Field>
        {delivered && (
          <Field label="Reason" required error={errs.reason} className={cx('sm:col-span-2', !line && 'lg:col-span-12')}>
            <Textarea rows={2} value={form.reason} invalid={!!errs.reason} maxLength={500} placeholder="Why is the cost changing after delivery?" onChange={(e) => set('reason', e.target.value)} />
          </Field>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={saving} icon={line ? undefined : <Plus className="h-4 w-4" />}>{line ? 'Save correction' : 'Add line'}</Button>
      </div>
    </form>
  )
}

export default function CostSheet() {
  const { itemId } = useParams()
  const { user } = useAuth()
  const { toast, confirm } = useUi()
  const { data, loading, error, reload } = useLoad<Sheet>(() => api.get(`/cost/items/${itemId}`), [itemId])
  const meta = useLoad<{ masters?: { material?: Material[] } }>(() => api.get('/meta'), [])
  const [editing, setEditing] = useState<CostLine | null>(null)
  const [voiding, setVoiding] = useState(0)

  const materials = useMemo(() => meta.data?.masters?.material ?? [], [meta.data])
  const lines = data?.lines ?? []
  const total = lines.reduce((s, l) => s + (l.voided ? 0 : l.amount), 0)
  const isSuper = user?.role === 'Super Admin'

  const voidLine = async (l: CostLine) => {
    const reason = await confirm({
      title: 'Void cost line', tone: 'danger', confirmLabel: 'Void line', reason: 'Reason',
      message: <>
        <p><b>{l.name}</b>, {money(l.amount, 2)}. The line stays in the history and is excluded from totals.</p>
        {data?.delivered && <Notice tone="warn" className="mt-3">{DELIVERED_MSG}</Notice>}
      </>,
    })
    if (!reason || typeof reason !== 'string') return
    setVoiding(l.id)
    try { const res = await api.post(`/cost/lines/${l.id}/void`, { reason }); toast.success(res.message); reload() } catch (e) { toast.error(errText(e)) } finally { setVoiding(0) }
  }

  const exportLines = () => data && exportRows(`Production Cost Sheet ${data.sheet_no ?? data.item_no.replace('/', '-')}`, lines.map((l) => ({
    'Name of the Item': l.name, 'Material Code': l.material_code ?? '', Rate: l.rate, Per: l.per, Amount: l.amount,
    'Entered by': l.entered_by ?? '', Date: l.entered_at ? fmtDateTime(l.entered_at) : '', Status: l.voided ? 'Voided' : 'Active', 'Void reason': l.void_reason ?? '',
  })))

  if (error) return <div><PageHeader title="Production Cost Sheet" /><ErrorNote error={error} /><Link to="/cost" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">Back to Production Cost</Link></div>
  if (!data) return <Spinner />

  const th = 'whitespace-nowrap border-b border-slate-200 px-4 py-2.5'
  return (
    <div className="print-area">
      <PageHeader title="Production Cost Sheet" subtitle={`${data.item_no}${data.product_name ? ` · ${data.product_name}` : ''}`}
        actions={<>
          <Link to="/cost"><Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />}>Production Cost</Button></Link>
          <Link to={`/items/${data.id}`}><Button variant="secondary">Open item</Button></Link>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportLines} disabled={!lines.length}>Excel</Button>
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
        </>} />
      <h1 className="mb-3 hidden text-xl font-bold text-brand-950 print:block">Production Cost Sheet</h1>

      {data.delivered && data.can_edit && <Notice tone="warn" className="mb-4 font-medium">{DELIVERED_MSG}</Notice>}

      <Card className="print-break-avoid mb-5" title="Item" subtitle="Filled automatically from the order"
        actions={!data.can_edit ? <Pill tone="slate">View only</Pill> : undefined}>
        <Facts cols={4} items={[
          ['Order No.', data.order_no],
          ['Item No.', data.item_no],
          ['Customer', data.customer],
          ['Product', [data.product_name, data.product_code].filter(Boolean).join(' · ')],
          ['Category', data.category],
          ['Site', data.site],
          ['Status', <StatusBadge status={data.status ?? data.stage} />],
          ['Cost Sheet No.', data.sheet_no ?? 'Created with the first line'],
          ['Order date', data.order_date ? fmtDate(data.order_date) : null],
          ['Delivery date', data.delivery_date ? fmtDate(data.delivery_date) : null],
          ['Order total cost', money(data.order_total_cost, 2)],
          ['Order Amount', isSuper && data.amount ? money(data.amount) : null],
          ['Margin', isSuper && data.amount ? <span className={data.amount - total >= 0 ? 'text-emerald-700' : 'text-red-600'}>{money(data.amount - total, 2)}</span> : null],
        ]} />
      </Card>

      <Card title="Cost lines" subtitle={`${num(lines.filter((l) => !l.voided).length)} active line(s)`} padded={false} className={cx(loading && 'opacity-70')}>
        {!lines.length ? <Empty title="No cost recorded yet" hint={data.can_edit ? 'Add the first line below.' : undefined} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th scope="col" className={th}>Name of the Item</th>
                  <th scope="col" className={cx(th, 'text-right')}>Rate</th>
                  <th scope="col" className={th}>Per</th>
                  <th scope="col" className={cx(th, 'text-right')}>Amount</th>
                  <th scope="col" className={th}>Entered by</th>
                  <th scope="col" className={th}>Date</th>
                  {data.can_edit && <th scope="col" className={cx(th, 'no-print')}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={cx('border-b border-slate-100 align-top', l.voided && 'bg-slate-50/70')}>
                    <td className="max-w-sm px-4 py-3">
                      <span className={cx('font-semibold', l.voided ? 'text-slate-400 line-through' : 'text-brand-950')}>{l.name}</span>
                      {l.material_code && <span className="ml-2 text-xs text-slate-500">{l.material_code}</span>}
                      {l.voided && <StatusBadge status="Voided" className="ml-2 !no-underline" />}
                      {l.voided && (
                        <p className="mt-1 text-xs text-slate-500">
                          {[l.void_reason && `Reason: ${l.void_reason}`, l.voided_by && `by ${l.voided_by}`, l.voided_at && fmtDateTime(l.voided_at)].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {!l.voided && !!l.history?.length && (
                        <p className="mt-1 text-xs text-slate-500">
                          Corrected {l.history.length === 1 ? 'once' : `${l.history.length} times`}; was {money(l.history[l.history.length - 1].amount, 2)}
                          {l.history[l.history.length - 1].reason ? ` · ${l.history[l.history.length - 1].reason}` : ''}
                        </p>
                      )}
                    </td>
                    <td className={cx('px-4 py-3 text-right tabular', l.voided && 'text-slate-400 line-through')}>{num(l.rate, 2)}</td>
                    <td className={cx('px-4 py-3', l.voided && 'text-slate-400 line-through')}>{l.per}</td>
                    <td className={cx('px-4 py-3 text-right font-semibold tabular', l.voided ? 'text-slate-400 line-through' : 'text-brand-950')}>{money(l.amount, 2)}</td>
                    <td className="px-4 py-3 text-slate-700">{l.entered_by}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{l.entered_at ? fmtDateTime(l.entered_at) : ''}</td>
                    {data.can_edit && (
                      <td className="whitespace-nowrap px-4 py-2 text-right no-print">
                        {!l.voided && <>
                          <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(l)}>Edit</Button>
                          <Button variant="ghost" size="sm" className="!text-red-600 hover:!bg-red-50" icon={<Ban className="h-3.5 w-3.5" />} loading={voiding === l.id} onClick={() => voidLine(l)}>Void</Button>
                        </>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50">
                  <td colSpan={3} className="px-4 py-3.5 text-right text-[13px] font-bold uppercase tracking-wide text-brand-900">Total Recorded Production Cost</td>
                  <td className="px-4 py-3.5 text-right font-display text-lg font-bold tabular text-brand-950">{money(total, 2)}</td>
                  <td colSpan={data.can_edit ? 3 : 2} className="px-4 py-3.5 text-xs text-slate-500">Voided lines are excluded</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {data.can_edit ? (
        <Card title="Add line" subtitle="Enter the amount directly; it is not calculated from the rate" className="mt-5 no-print">
          <LineForm itemId={data.id} materials={materials} delivered={data.delivered} onSaved={reload} />
        </Card>
      ) : (
        <p className="mt-4 text-sm text-slate-500 no-print">View only. Cost lines are entered by users with cost permission.</p>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Correct cost line">
        {editing && <>
          {data.delivered && <Notice tone="warn" className="mb-4">{DELIVERED_MSG}</Notice>}
          <LineForm key={editing.id} itemId={data.id} line={editing} materials={materials} delivered={data.delivered}
            onSaved={() => { setEditing(null); reload() }} onCancel={() => setEditing(null)} />
        </>}
      </Modal>
    </div>
  )
}
