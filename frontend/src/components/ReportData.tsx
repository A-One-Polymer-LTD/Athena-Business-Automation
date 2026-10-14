// What each stage has recorded so far for the item's Production Report (BRD 9.8, FR-PR-04).
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { Card, ProgressBar, cx } from './ui'

export interface ReportDataRow { key: string; label: string; who: string; status: 'done' | 'missing' | 'waiting'; detail?: string }

const ICON = {
  done: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  missing: <AlertTriangle className="h-4 w-4 text-orange-600" />,
  waiting: <Clock className="h-4 w-4 text-slate-400" />,
}
const TEXT = { done: 'Recorded', missing: 'Not recorded', waiting: 'Later stage' }

export default function ReportData({ rows, delivered }: { rows: ReportDataRow[]; delivered?: boolean }) {
  const done = rows.filter((r) => r.status === 'done').length
  const missing = rows.filter((r) => r.status === 'missing').length
  return (
    <Card title="Production Report data"
      subtitle={delivered
        ? 'The Production Report was generated from these records when the item was delivered.'
        : 'Each stage records its part as the work happens. Marking the item Delivered generates the Production Report from these records.'}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ProgressBar value={rows.length ? (done / rows.length) * 100 : 0} tone={missing ? 'amber' : 'green'} className="max-w-xs" />
        <span className="text-sm font-semibold text-brand-950">{done} of {rows.length} recorded</span>
        {missing > 0 && <span className="text-sm font-semibold text-orange-700">{missing} missing: the report will show "Not recorded" for {missing === 1 ? 'it' : 'them'}</span>}
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 shrink-0">{ICON[r.status]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-brand-950">{r.label}</p>
              <p className="text-xs text-slate-500">Entered by {r.who}</p>
              {r.detail && <p className="mt-0.5 break-words text-xs text-slate-700">{r.detail}</p>}
            </div>
            <span className={cx('shrink-0 text-xs font-semibold', r.status === 'done' ? 'text-emerald-700' : r.status === 'missing' ? 'text-orange-700' : 'text-slate-400')}>
              {TEXT[r.status]}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
