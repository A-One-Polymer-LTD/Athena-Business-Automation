// P3 Site Board: production sites (rows) against stages (columns) with item counts.
import { Download, LayoutGrid } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, Empty, ErrorNote, Modal, PageHeader, Pill, Spinner, StatusBadge, cx, useLoad } from '../../components/ui'
import { api, qs } from '../../lib/api'
import { exportRows } from '../../lib/export'
import { fmtDate } from '../../lib/format'

interface BoardSite { id: number; code: string; name: string; type?: string; active?: boolean; apm?: string; counts: Record<string, number>; total: number }
interface Board { stages: string[]; sites: BoardSite[] }
interface Item {
  id: number; item_no: string; customer: string; product_name?: string; site?: string; apm?: string; stage: string; status: string
  days_in_stage?: number; delayed?: boolean; promised_date?: string
}
interface Cell { site?: BoardSite; stage?: string; count: number }

const heat = (n: number, max: number) => {
  const r = n / (max || 1)
  return r > 0.75 ? 'bg-brand-700 text-white hover:bg-brand-800' : r > 0.5 ? 'bg-brand-500 text-white hover:bg-brand-600'
    : r > 0.25 ? 'bg-brand-200 text-brand-950 hover:bg-brand-300' : 'bg-brand-100 text-brand-900 hover:bg-brand-200'
}

export default function SiteBoard() {
  const { data, loading, error } = useLoad<Board>(() => api.get('/site-board'))
  const [cell, setCell] = useState<Cell | null>(null)

  const stages = data?.stages ?? []
  const sites = data?.sites ?? []
  const max = Math.max(1, ...sites.flatMap((s) => Object.values(s.counts)))
  const colTotal = (st: string) => sites.reduce((a, s) => a + (s.counts[st] ?? 0), 0)
  const grand = sites.reduce((a, s) => a + s.total, 0)

  const doExport = () => exportRows('Site board', [
    ...sites.map((s) => ({
      Site: s.code, Name: s.name, Type: s.type ?? '', APM: s.apm ?? '', Status: s.active === false ? 'Inactive' : 'Active',
      ...Object.fromEntries(stages.map((st) => [st, s.counts[st] ?? 0])), Total: s.total,
    })),
    { Site: 'Total', Name: '', Type: '', APM: '', Status: '', ...Object.fromEntries(stages.map((st) => [st, colTotal(st)])), Total: grand },
  ], 'Site board')

  const num = (count: number, onClick: () => void, cls: string, label: string) => (
    <button type="button" onClick={onClick} aria-label={label} className={cx('mx-auto flex h-10 w-full min-w-12 items-center justify-center rounded-lg text-sm font-bold tabular transition', cls)}>{count}</button>
  )

  return (
    <>
      <PageHeader title="Site Board" subtitle="Items in production at each site, by stage. Select a number to see the items behind it."
        actions={<Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={doExport} disabled={!sites.length}>Excel</Button>} />

      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : sites.length === 0 ? (
        <Card><Empty icon={<LayoutGrid className="h-6 w-6" />} title="No production sites yet" hint="Sites appear here once they are set up in the master data." /></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left">Site</th>
                  {stages.map((st) => <th key={st} scope="col" className="w-24 max-w-24 whitespace-normal border-b border-slate-200 px-2 py-3 text-center align-bottom leading-tight">{st}</th>)}
                  <th scope="col" className="border-b border-l border-slate-200 px-3 py-3 text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const off = s.active === false
                  return (
                    <tr key={s.id} className="border-b border-slate-100">
                      <th scope="row" className={cx('sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-2.5 text-left font-normal', off && 'text-slate-400')}>
                        <div className="flex items-center gap-2">
                          <span className={cx('font-display text-[15px] font-bold', off ? 'text-slate-400' : 'text-brand-950')}>{s.code}</span>
                          {s.type === 'Contract' && <Pill tone="gold">Contract</Pill>}
                          {off && <Pill>Inactive</Pill>}
                        </div>
                        <p className="max-w-44 truncate text-xs text-slate-500">{s.apm ?? 'No APM mapped'}</p>
                      </th>
                      {stages.map((st) => {
                        const n = s.counts[st] ?? 0
                        return (
                          <td key={st} className="px-1.5 py-1.5 text-center">
                            {n ? num(n, () => setCell({ site: s, stage: st, count: n }), heat(n, max), `${n} items at ${st} on ${s.code}`)
                              : <span className="text-slate-300">·</span>}
                          </td>
                        )
                      })}
                      <td className="border-l border-slate-200 px-1.5 py-1.5 text-center">
                        {s.total ? num(s.total, () => setCell({ site: s, count: s.total }), 'bg-gold-100 text-gold-700 hover:bg-gold-200', `${s.total} items on ${s.code}`)
                          : <span className="text-slate-300">0</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <th scope="row" className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">All sites</th>
                  {stages.map((st) => {
                    const n = colTotal(st)
                    return (
                      <td key={st} className="px-1.5 py-1.5 text-center">
                        {n ? num(n, () => setCell({ stage: st, count: n }), 'text-brand-900 hover:bg-brand-100', `${n} items at ${st} on all sites`) : <span className="text-slate-300">0</span>}
                      </td>
                    )
                  })}
                  <td className="border-l border-slate-200 px-3 py-3 text-center font-display text-base font-bold tabular text-brand-950">{grand}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            <span>Load:</span>
            {[['bg-brand-100', 'Light'], ['bg-brand-200', 'Moderate'], ['bg-brand-500', 'Busy'], ['bg-brand-700', 'Heaviest']].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1.5"><span className={cx('h-3 w-5 rounded', c)} />{l}</span>
            ))}
          </div>
        </div>
      )}

      {cell && <CellItems cell={cell} onClose={() => setCell(null)} />}
    </>
  )
}

function CellItems({ cell, onClose }: { cell: Cell; onClose: () => void }) {
  const { data, loading, error } = useLoad<Item[]>(() => api.get(`/items${qs({ scope: 'production', site_id: cell.site?.id, stage: cell.stage })}`))
  const columns: Column<Item>[] = [
    { key: 'item_no', header: 'Item No.', render: (i) => <Link to={`/items/${i.id}`} className="font-semibold text-brand-800 hover:underline">{i.item_no}</Link> },
    { key: 'product_name', header: 'Product' },
    { key: 'customer', header: 'Customer' },
    { key: 'site', header: 'Site' },
    { key: 'stage', header: 'Stage' },
    { key: 'status', header: 'Status', render: (i) => <span className="inline-flex items-center gap-1.5"><StatusBadge status={i.status} />{i.delayed && <StatusBadge status="Delayed" />}</span> },
    { key: 'days_in_stage', header: 'Days in stage', align: 'right' },
    { key: 'promised_date', header: 'Promised', render: (i) => (i.promised_date ? fmtDate(i.promised_date) : null) },
  ]
  const title = [cell.site ? `${cell.site.code} — ${cell.site.name}` : 'All sites', cell.stage ?? 'All stages'].join(' · ')
  return (
    <Modal open onClose={onClose} title={title} size="xl">
      {loading ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <DataTable rows={data ?? []} columns={columns} rowKey={(i) => i.id} dense exportName={`Site board ${cell.site?.code ?? 'all sites'} ${cell.stage ?? ''}`.trim().replace(/[\\/]/g, '-')}
          emptyTitle="No items here now" emptyHint="The board may have changed since it was loaded." />
      )}
    </Modal>
  )
}
