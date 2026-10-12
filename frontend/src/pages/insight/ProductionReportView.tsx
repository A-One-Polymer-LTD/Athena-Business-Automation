// X7 Production Report view (Workflow I): a printable document built from the stored report data.
import { ArrowLeft, Download, FileDown, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ImageStrip } from '../../components/AuthImage'
import { Button, Card, ErrorNote, Notice, Pill, Spinner, StatusBadge, cx, useLoad } from '../../components/ui'
import { api } from '../../lib/api'
import { exportSheets } from '../../lib/export'
import { dims, fmtDate, fmtDateTime, hoursLabel, money, num } from '../../lib/format'

const NR = 'Not recorded'
type Dim = { height?: number | null; width?: number | null; length?: number | null }
interface Stage { stage: string; kind?: string; start?: string; end?: string; hours?: number; user?: string; note?: string }
interface QcResult { result: string; checker?: string; at?: string; note?: string; photo?: string }
interface ReportData {
  header: Record<string, any>
  product: {
    product_desc?: string; design_desc?: string; ordered?: Dim; final?: Dim | string; wood_requisition?: string[] | null
    colour?: string; wood?: string; upholstery?: string; images?: string[]
  }
  materials?: { material: string; code?: string; details?: string; measurement?: string; qty?: number; source?: string }[]
  no_requisition_remark?: string | null
  stages?: Stage[]
  lead_time_days?: number | null
  production_days?: number | null
  qc?: {
    qc_ref?: string; carpenter_side?: string; remarks?: string; rework_count?: number; checks?: { label: string; results: QcResult[] }[]
    apm_sign?: string; apm_signed_at?: string; pm_sign?: string; pm_signed_at?: string
  } | null
  cost?: {
    sheet_no?: string | null; total: number
    lines: { name: string; code?: string; rate: number; per: string; amount: number; entered_by?: string; entered_at?: string; voided?: boolean; void_reason?: string }[]
  }
  delivery?: { finish_good?: string | null; packed?: string | null; ready?: string | null; delivered?: string | null; delivery_date?: string | null; delivered_by?: string | null; receiver?: string | null }
  missing?: string[]
}
interface Revision { id: number; report_no: string; revision: number; status: string; generated_at?: string; reason?: string; is_current?: boolean }
interface Report {
  id: number; report_no: string; revision: number; status: string; is_current?: boolean; reason?: string; generated_at?: string; item_id: number
  data: ReportData; show_cost: boolean; revisions: Revision[]
}

const has = (v: unknown) => v !== null && v !== undefined && v !== ''
const Missing = () => <span className="font-medium italic text-orange-600">{NR}</span>
/** Text value; the marker "Not recorded" is shown in orange italics. */
const val = (v: unknown): ReactNode => (!has(v) ? null : v === NR ? <Missing /> : String(v))
const when = (v: unknown, withTime = true): ReactNode => (!has(v) ? null : v === NR ? <Missing /> : withTime ? fmtDateTime(String(v)) : fmtDate(String(v)))
const plain = (v: unknown, withTime = true) => (!has(v) ? '' : v === NR ? NR : withTime ? fmtDateTime(String(v)) : fmtDate(String(v)))
const join = (...parts: unknown[]) => parts.filter((p) => has(p) && p !== NR).join(' · ')

const WAREHOUSE = ['Finish Good', 'In Warehouse', 'Packed', 'Ready for Delivery', 'Delivered']
const TINTS = {
  making: { label: 'Making', color: '#52525b' },
  qc: { label: 'QC', color: '#059669' },
  rework: { label: 'Rework', color: '#dc2626' },
  upholstery: { label: 'Upholstery', color: '#ea580c' },
  warehouse: { label: 'Warehouse and delivery', color: '#d4a63d' },
} as const
type Tint = keyof typeof TINTS
const tintOf = (s: Stage): Tint => (s.kind === 'rework' ? 'rework' : /QC$/.test(s.stage) ? 'qc' : s.stage === 'Upholstery' ? 'upholstery' : WAREHOUSE.includes(s.stage) ? 'warehouse' : 'making')

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="print-break-avoid border-t border-slate-200 px-5 py-5 sm:px-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="border-l-4 border-brand-800 pl-3 text-[13px] font-bold uppercase tracking-wider text-brand-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Label / value grid that drops empty values. */
function Grid({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: 2 | 3 | 4 }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
  if (!shown.length) return null
  const grid = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4 print:grid-cols-4' }
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-3', grid[cols])}>
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-brand-950">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const TH = 'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500'
const TD = 'border-b border-slate-100 px-3 py-2 align-top text-slate-800'

export default function ProductionReportView() {
  const { id } = useParams()
  const { data: rep, error } = useLoad<Report>(() => api.get(`/production-reports/${id}`), [id])

  if (error) return <div><ErrorNote error={error} /><Link to="/reports" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">Back to Production Reports</Link></div>
  if (!rep || String(rep.id) !== String(id)) return <Spinner />

  const d = rep.data
  const h = d.header ?? {}
  const p = d.product ?? {}
  const materials = d.materials ?? []
  const stages = d.stages ?? []
  const qc = d.qc ?? null
  const cost = rep.show_cost ? d.cost : undefined
  const del = d.delivery ?? {}
  const missing = d.missing ?? []
  const current = rep.revisions.find((r) => r.is_current)
  const isCurrent = rep.is_current ?? current?.id === rep.id

  const totalHours = stages.reduce((s, x) => s + Math.max(0, x.hours ?? 0), 0)
  const minShare = totalHours > 0 ? totalHours * 0.012 : 1
  const usedTints = (Object.keys(TINTS) as Tint[]).filter((t) => stages.some((s) => tintOf(s) === t))
  const finalDims = p.final && typeof p.final === 'object' ? dims(p.final.height, p.final.width, p.final.length) : val(p.final)
  const sequence = (rs: QcResult[]) => rs.map((r) => r.result).join(', then ')

  const exportExcel = () => {
    const summary: [string, unknown][] = [
      ['Report No.', rep.report_no], ['Status', rep.status], ['Generated', plain(rep.generated_at)], ['Revision reason', rep.reason],
      ['Order No.', h.order_no], ['Item No.', h.item_no], ['Customer', h.customer], ['Sales Admin', h.sales_admin], ['Branch', h.branch],
      ['Site', h.site], ['APM', h.apm], ['Product', h.product_name], ['Product code', h.product_code], ['Category', h.category],
      ['Order date', plain(h.order_date, false)], ['Ordered H / W / L', p.ordered ? dims(p.ordered.height, p.ordered.width, p.ordered.length) : ''],
      ['Final confirmed H / W / L', typeof p.final === 'object' && p.final ? dims(p.final.height, p.final.width, p.final.length) : p.final],
      ['Wood requisition measurement', (p.wood_requisition ?? []).join('; ')], ['Colour', p.colour], ['Wood', p.wood], ['Upholstery', p.upholstery],
      ['Product description', p.product_desc], ['Design description', p.design_desc],
      ['Total lead time (days)', d.lead_time_days], ['Production days', d.production_days],
      ['Finish Good', plain(del.finish_good)], ['Packed', plain(del.packed)], ['Ready for Delivery', plain(del.ready)], ['Delivered', plain(del.delivered)],
      ['Delivered by', del.delivered_by], ['Received by', del.receiver], ['Missing parts', missing.join('; ')],
    ]
    const sheets: { name: string; rows: Record<string, any>[] }[] = [
      { name: 'Summary', rows: summary.filter(([, v]) => has(v)).map(([k, v]) => ({ Field: k, Value: v })) },
      { name: 'Materials', rows: materials.map((m) => ({ Material: m.material, Code: m.code ?? '', Details: m.details ?? '', Measurement: m.measurement ?? '', Qty: m.qty ?? '', Source: m.source ?? '' })) },
      { name: 'Stages', rows: stages.map((s) => ({ Stage: s.stage, Type: TINTS[tintOf(s)].label, Start: plain(s.start), End: plain(s.end), Hours: Math.max(0, s.hours ?? 0), User: s.user ?? '', Note: s.note ?? '' })) },
      { name: 'QC', rows: (qc?.checks ?? []).flatMap((c) => c.results.map((r, i) => ({ Check: c.label, Attempt: i + 1, Result: r.result, 'Checked by': r.checker ?? '', Time: plain(r.at), Note: r.note ?? '' }))) },
    ]
    if (cost) {
      sheets.push({ name: 'Cost', rows: [
        ...cost.lines.map((l) => ({ 'Name of the Item': l.name, Code: l.code ?? '', Rate: l.rate, Per: l.per, Amount: l.amount, 'Entered by': l.entered_by ?? '', Date: plain(l.entered_at), Status: l.voided ? 'Voided' : 'Active', 'Void reason': l.void_reason ?? '' })),
        { 'Name of the Item': 'Total Recorded Production Cost', Code: '', Rate: '', Per: '', Amount: cost.total, 'Entered by': '', Date: '', Status: '', 'Void reason': '' },
      ] })
    }
    exportSheets(`Production Report ${rep.report_no}`, sheets)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <Link to="/reports"><Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />}>Production Reports</Button></Link>
        <Link to={`/items/${rep.item_id}`}><Button variant="secondary">Open item</Button></Link>
      </div>

      {!isCurrent && (
        <Notice tone="warn" className="mb-4 no-print">
          You are viewing an earlier revision of this report.{' '}
          {current && <Link to={`/reports/${current.id}`} className="font-semibold underline">Open the current revision ({current.report_no})</Link>}
        </Notice>
      )}

      <article className="print-area overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        {/* title band */}
        <header className="flex flex-wrap items-center justify-between gap-4 bg-brand-800 px-5 py-5 text-white [print-color-adjust:exact] [-webkit-print-color-adjust:exact] sm:px-7">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/80">Athena OS</p>
            <h1 className="mt-1 text-xl font-bold tracking-wide sm:text-2xl">PRODUCTION REPORT</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/90">
              <span className="font-display text-base font-bold text-white">{rep.report_no}</span>
              <StatusBadge status={rep.status} className={rep.status === 'Generated' ? '!bg-white !text-brand-900' : undefined} />
              {!isCurrent && <Pill tone="orange">Earlier revision</Pill>}
            </p>
            <p className="mt-1 text-xs text-white/80">generated automatically on delivery, {fmtDateTime(rep.generated_at)}</p>
            {rep.reason && <p className="mt-1 text-xs text-white/80">Revision reason: {rep.reason}</p>}
          </div>
          <div className="flex flex-wrap gap-2 no-print">
            <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
            <Button variant="secondary" size="sm" icon={<FileDown className="h-4 w-4" />} onClick={() => window.print()}>PDF</Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
          </div>
        </header>

        {missing.length > 0 && (
          <div className="px-5 pt-5 sm:px-7">
            <Notice tone="warn"><b>Incomplete.</b> These parts were not recorded: {missing.join(', ')}.</Notice>
          </div>
        )}

        {/* header grid */}
        <div className="print-break-avoid px-5 py-5 sm:px-7">
          <Grid items={[
            ['Order / Item', <Link to={`/items/${rep.item_id}`} className="text-brand-700 hover:underline print:text-brand-950">{h.item_no ?? h.order_no}</Link>],
            ['Customer', join(h.customer, h.customer_code)],
            ['Sales Admin / Branch', join(h.sales_admin, h.branch)],
            ['Site / APM', <>{val(h.site)}{has(h.apm) && <> · {val(h.apm)}</>}</>],
            ['Product', join(h.product_name, h.product_code, h.category)],
            ['Delivered', has(del.delivered) ? when(del.delivered) : when(del.delivery_date, false)],
            ['Order date', when(h.order_date, false)],
            ['Order amount', has(h.order_amount) ? money(h.order_amount) : null],
          ]} />
        </div>

        <Section title="1. Product and measurements">
          <Grid items={[
            ['Ordered H / W / L', p.ordered && (p.ordered.height || p.ordered.width || p.ordered.length) ? dims(p.ordered.height, p.ordered.width, p.ordered.length) : null],
            ['Final confirmed H / W / L', finalDims],
            ['Wood requisition measurement', p.wood_requisition?.length ? p.wood_requisition.join('; ') : null],
            ['Colour', val(p.colour)],
            ['Wood', val(p.wood)],
            ['Upholstery', val(p.upholstery)],
            ['Product description', val(p.product_desc)],
            ['Design description', val(p.design_desc)],
          ]} />
          {!!p.images?.length && <div className="mt-4"><ImageStrip images={p.images} /></div>}
        </Section>

        <Section title="2. Materials used">
          {!materials.length ? (
            <p className="text-sm">{d.no_requisition_remark ? <span className="text-slate-700">No requisition was raised: {d.no_requisition_remark}</span> : <Missing />}</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead><tr>{['Material', 'Code', 'Details', 'Measurement', 'Qty', 'Source'].map((x) => <th key={x} scope="col" className={cx(TH, x === 'Qty' && 'text-right')}>{x}</th>)}</tr></thead>
                  <tbody>
                    {materials.map((m, i) => (
                      <tr key={i}>
                        <td className={cx(TD, 'font-semibold text-brand-950')}>{m.material}</td>
                        <td className={TD}>{m.code}</td><td className={TD}>{m.details}</td><td className={TD}>{m.measurement}</td>
                        <td className={cx(TD, 'text-right tabular')}>{has(m.qty) ? num(m.qty, (m.qty ?? 0) % 1 ? 2 : 0) : ''}</td>
                        <td className={TD}>{m.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.no_requisition_remark && <p className="mt-2 text-xs text-slate-600">Remark: {d.no_requisition_remark}</p>}
            </>
          )}
        </Section>

        <Section title={`3. Production stage timeline${has(d.lead_time_days) ? ` (total lead time ${d.lead_time_days} days)` : ''}`}
          aside={has(d.production_days) ? <span className="text-xs text-slate-500">Production: {d.production_days} days (assigned to Finish Good)</span> : undefined}>
          {!stages.length ? <Missing /> : (
            <>
              <div className="flex h-7 w-full overflow-hidden rounded-md bg-slate-100 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]" role="img" aria-label="Stage timeline, width by time spent">
                {stages.map((s, i) => (
                  <div key={i} title={`${s.stage}${s.kind === 'rework' ? ' (rework)' : ''}: ${hoursLabel(Math.max(0, s.hours ?? 0))}`}
                    className="h-full border-r border-white/70 last:border-0" style={{ flexGrow: Math.max(s.hours ?? 0, minShare), flexBasis: 0, minWidth: 2, backgroundColor: TINTS[tintOf(s)].color }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {usedTints.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm [print-color-adjust:exact] [-webkit-print-color-adjust:exact]" style={{ backgroundColor: TINTS[t].color }} />{TINTS[t].label}
                  </span>
                ))}
              </div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead><tr>{['Stage', 'Start', 'End', 'Duration', 'User', 'Note'].map((x) => <th key={x} scope="col" className={TH}>{x}</th>)}</tr></thead>
                  <tbody>
                    {stages.map((s, i) => (
                      <tr key={i}>
                        <td className={cx(TD, 'whitespace-nowrap font-semibold text-brand-950')}>
                          <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm [print-color-adjust:exact] [-webkit-print-color-adjust:exact]" style={{ backgroundColor: TINTS[tintOf(s)].color }} />
                          {s.stage}{s.kind === 'rework' && <Pill tone="red" className="ml-2">Rework</Pill>}
                        </td>
                        <td className={cx(TD, 'whitespace-nowrap')}>{s.start ? fmtDateTime(s.start) : ''}</td>
                        <td className={cx(TD, 'whitespace-nowrap')}>{s.end ? fmtDateTime(s.end) : ''}</td>
                        <td className={cx(TD, 'whitespace-nowrap tabular')}>{hoursLabel(Math.max(0, s.hours ?? 0))}</td>
                        <td className={cx(TD, 'whitespace-nowrap')}>{s.user}</td>
                        <td className={cx(TD, 'max-w-xs')}>{s.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>

        <Section title={`4. Quality control${qc?.qc_ref ? ` (unified QC report ${qc.qc_ref})` : ''}`}>
          {!qc ? <Missing /> : (
            <>
              {!!qc.checks?.length && (
                <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {qc.checks.map((c) => (
                    <li key={c.label} className="px-3.5 py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-brand-950">{c.label}</span>
                        <span className={cx('text-sm font-bold', c.results.some((r) => r.result === 'Rework') ? 'text-red-600' : 'text-emerald-700')}>{sequence(c.results)}</span>
                      </div>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {c.results.map((r, i) => <li key={i}>{[r.result, r.checker, r.at && fmtDateTime(r.at), r.note].filter(Boolean).join(' · ')}</li>)}
                      </ul>
                      {c.results.some((r) => r.photo) && <div className="mt-2"><ImageStrip size="h-14 w-16" images={c.results.filter((r) => r.photo).map((r) => r.photo as string)} /></div>}
                    </li>
                  ))}
                </ul>
              )}
              <Grid cols={4} items={[
                ['Carpenter working side', val(qc.carpenter_side)],
                ['Rework count', num(qc.rework_count ?? 0)],
                ['APM sign-off', has(qc.apm_sign) ? <>{val(qc.apm_sign)}{qc.apm_signed_at && <span className="block text-xs font-normal text-slate-500">{fmtDateTime(qc.apm_signed_at)}</span>}</> : null],
                ['Production Manager sign-off', has(qc.pm_sign) ? <>{val(qc.pm_sign)}{qc.pm_signed_at && <span className="block text-xs font-normal text-slate-500">{fmtDateTime(qc.pm_signed_at)}</span>}</> : null],
                ['Remarks', val(qc.remarks)],
              ]} />
            </>
          )}
        </Section>

        {cost && (
          <Section title="5. Production cost (cost-permitted users only)" aside={cost.sheet_no ? <span className="text-xs text-slate-500">Cost Sheet {cost.sheet_no}</span> : undefined}>
            {!cost.lines.length ? <Missing /> : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead><tr>{['Name of the Item', 'Rate', 'Per', 'Amount', 'Entered by', 'Date'].map((x) => <th key={x} scope="col" className={cx(TH, (x === 'Rate' || x === 'Amount') && 'text-right')}>{x}</th>)}</tr></thead>
                  <tbody>
                    {cost.lines.map((l, i) => {
                      const strike = l.voided ? 'text-slate-400 line-through' : ''
                      return (
                        <tr key={i}>
                          <td className={TD}>
                            <span className={cx('font-semibold', l.voided ? strike : 'text-brand-950')}>{l.name}</span>
                            {l.code && <span className="ml-2 text-xs text-slate-500">{l.code}</span>}
                            {l.voided && <span className="ml-2 text-xs text-slate-500">Voided{l.void_reason ? `: ${l.void_reason}` : ''} (excluded)</span>}
                          </td>
                          <td className={cx(TD, 'text-right tabular', strike)}>{num(l.rate, 2)}</td>
                          <td className={cx(TD, strike)}>{l.per}</td>
                          <td className={cx(TD, 'text-right font-semibold tabular', strike)}>{money(l.amount, 2)}</td>
                          <td className={cx(TD, 'whitespace-nowrap')}>{l.entered_by}</td>
                          <td className={cx(TD, 'whitespace-nowrap')}>{l.entered_at ? fmtDate(l.entered_at) : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
              <span className="text-[13px] font-bold uppercase tracking-wide text-brand-900">Total Recorded Production Cost</span>
              <span className="font-display text-xl font-bold tabular text-brand-950">{money(cost.total, 2)}</span>
            </div>
          </Section>
        )}

        <Section title={`${cost ? 6 : 5}. Packing and delivery`}>
          <Grid cols={4} items={[
            ['Finish Good', when(del.finish_good)],
            ['Packed', when(del.packed)],
            ['Ready for Delivery', when(del.ready)],
            ['Delivered', has(del.delivered) ? when(del.delivered) : when(del.delivery_date, false)],
            ['Delivered by', val(del.delivered_by)],
            ['Received by', val(del.receiver)],
          ]} />
        </Section>
      </article>

      <Card title="Revisions" subtitle="A new revision is created whenever the report is regenerated" className="mt-5 no-print" padded={false}>
        <ul className="divide-y divide-slate-100">
          {[...rep.revisions].sort((a, b) => b.revision - a.revision).map((r) => (
            <li key={r.id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm', r.id === rep.id && 'bg-brand-50/60')}>
              <span className="font-semibold text-brand-950">{r.report_no}</span>
              <StatusBadge status={r.status} />
              {r.is_current && <Pill tone="green">Current</Pill>}
              <span className="text-slate-500">{fmtDateTime(r.generated_at)}</span>
              {r.reason && <span className="min-w-0 flex-1 basis-full text-slate-600 sm:basis-auto">{r.reason}</span>}
              <span className="ml-auto">
                {r.id === rep.id ? <span className="text-xs font-semibold text-slate-500">Viewing</span>
                  : <Link to={`/reports/${r.id}`} className="font-semibold text-brand-700 hover:underline">Open</Link>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
