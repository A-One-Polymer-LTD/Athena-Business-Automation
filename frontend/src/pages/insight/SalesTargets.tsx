// X8 Sales Targets and period locks: Super Admin only.
import { Copy, Download, Lock, Save, Unlock, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, Card, Empty, ErrorNote, Modal, Notice, PageHeader, Select, Spinner, StatusBadge, cx, errText, useLoad, useUi,
} from '../../components/ui'
import { ApiError, api } from '../../lib/api'
import { downloadTemplate, readSheet } from '../../lib/export'
import { MONTH_NAMES, num } from '../../lib/format'

const FIELDS = ['sales', 'collection', 'delivery', 'visits', 'leads', 'orders'] as const
type TargetField = typeof FIELDS[number]
const LABELS: Record<TargetField, string> = { sales: 'Sales', collection: 'Collection', delivery: 'Delivery', visits: 'Client Visits', leads: 'Leads', orders: 'Orders' }
const WHOLE: TargetField[] = ['visits', 'leads', 'orders']

type TargetRow = { sales_admin_id: number; name: string; login_id: string; branch?: string } & Record<TargetField, number>
interface TargetsData { locked: boolean; rows: TargetRow[]; locks: { year: number; month: number }[] }
type Grid = Record<number, Record<TargetField, string>>

const toGrid = (rows: TargetRow[]): Grid =>
  Object.fromEntries(rows.map((r) => [r.sales_admin_id, Object.fromEntries(FIELDS.map((f) => [f, r[f] ? String(r[f]) : ''])) as Record<TargetField, string>]))
const bad = (v: string) => v.trim() !== '' && (Number.isNaN(Number(v)) || Number(v) < 0)

export default function SalesTargets() {
  const { toast, confirm } = useUi()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const { data, loading, error, reload } = useLoad<TargetsData>(() => api.get(`/sales/targets?year=${year}&month=${month}`), [year, month])
  const [grid, setGrid] = useState<Grid>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [formError, setFormError] = useState('')
  const [importErrors, setImportErrors] = useState<{ message: string; rows: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (data) { setGrid(toGrid(data.rows)); setDirty(false); setFormError('') } }, [data])

  const label = `${MONTH_NAMES[month - 1]} ${year}`
  const locked = !!data?.locked
  const rows = data?.rows ?? []
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() + 1 - i)
  const totals = useMemo(() => Object.fromEntries(FIELDS.map((f) => [f, rows.reduce((s, r) => s + (Number(grid[r.sales_admin_id]?.[f]) || 0), 0)])) as Record<TargetField, number>, [rows, grid])
  const invalid = rows.some((r) => FIELDS.some((f) => bad(grid[r.sales_admin_id]?.[f] ?? '')))

  const setCell = (id: number, f: TargetField, v: string) => { setGrid((g) => ({ ...g, [id]: { ...g[id], [f]: v } })); setDirty(true) }
  const fail = (e: unknown) => toast.error(errText(e))

  const save = async () => {
    if (invalid) { setFormError('Targets must be 0 or more. Please correct the highlighted values.'); return }
    setBusy('save'); setFormError('')
    try {
      const res = await api.put('/sales/targets', {
        year, month,
        rows: rows.map((r) => ({ sales_admin_id: r.sales_admin_id, ...Object.fromEntries(FIELDS.map((f) => [f, Number(grid[r.sales_admin_id]?.[f]) || 0])) })),
      })
      toast.success(res.message)
      reload()
    } catch (e) {
      if (e instanceof ApiError && e.rows?.length) setImportErrors({ message: e.message, rows: e.rows })
      else setFormError(errText(e))
    } finally { setBusy('') }
  }

  const copy = async () => {
    const ok = await confirm({ title: 'Copy from last month', message: `Targets for ${label} will be replaced by last month's targets.`, confirmLabel: 'Copy targets' })
    if (!ok) return
    setBusy('copy')
    try { const res = await api.post('/sales/targets/copy', { year, month }); toast.success(res.message); reload() } catch (e) { fail(e) } finally { setBusy('') }
  }

  const template = () => downloadTemplate(`Sales targets template ${label}`, ['login_id', 'name', ...FIELDS],
    rows.length ? [rows[0].login_id, rows[0].name, 5000000, 4500000, 4000000, 40, 12, 6] : ['sales1', 'Sales Admin name', 5000000, 4500000, 4000000, 40, 12, 6])

  const importFile = async (file: File) => {
    setBusy('import')
    try {
      const sheet = await readSheet(file)
      const clean = (v: any) => (typeof v === 'string' ? v.replace(/,/g, '').trim() : v)
      const payload = sheet
        .filter((r) => Object.values(r).some((v) => v !== '' && v !== null && v !== undefined))
        .map((r) => ({ login_id: String(r.login_id ?? '').trim(), ...Object.fromEntries(FIELDS.map((f) => [f, clean(r[f])])) }))
      if (!payload.length) { toast.error('The file has no rows. Please use the template.'); return }
      const res = await api.put('/sales/targets', { year, month, rows: payload, by_login: true })
      toast.success(res.message)
      reload()
    } catch (e) {
      if (e instanceof ApiError && e.rows?.length) setImportErrors({ message: e.message, rows: e.rows })
      else fail(e)
    } finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
  }

  const toggleLock = async () => {
    let body: Record<string, any>
    if (locked) {
      const reason = await confirm({ title: `Unlock ${label}`, message: 'Sales entries and targets for this period can be changed again after unlocking.', reason: 'Reason for unlocking', confirmLabel: 'Unlock period', tone: 'warn' })
      if (!reason) return
      body = { year, month, locked: false, reason }
    } else {
      const ok = await confirm({ title: `Lock ${label}`, message: 'Sales entries and targets for this period can no longer be changed while it is locked.', confirmLabel: 'Lock period' })
      if (!ok) return
      body = { year, month, locked: true }
    }
    setBusy('lock')
    try { const res = await api.post('/sales/locks', body); toast.success(res.message); reload() } catch (e) { fail(e) } finally { setBusy('') }
  }

  return (
    <div>
      <PageHeader title="Sales Targets" subtitle="Monthly targets for each Sales Admin, and period locks" />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="w-28"><Select aria-label="Month" value={month} onChange={(e) => setMonth(+e.target.value)}>
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select></div>
        <div className="w-24"><Select aria-label="Year" value={year} onChange={(e) => setYear(+e.target.value)}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select></div>
        {locked && <StatusBadge status="Locked" />}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copy} loading={busy === 'copy'} disabled={locked || !data}>Copy from last month</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={template}>Download template</Button>
          <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()} loading={busy === 'import'} disabled={locked || !data}>Import from Excel</Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f) }} />
          <Button variant={locked ? 'gold' : 'secondary'} size="sm" icon={locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />} onClick={toggleLock} loading={busy === 'lock'} disabled={!data}>
            {locked ? 'Unlock period' : 'Lock period'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <Card title={`Targets for ${label}`} subtitle="Enter 0 or more for each measure" padded={false}
            actions={<Button icon={<Save className="h-4 w-4" />} onClick={save} loading={busy === 'save'} disabled={locked || !rows.length || !dirty}>Save targets</Button>}>
            {error ? <div className="p-5"><ErrorNote error={error} /></div> : loading && !data ? <Spinner /> : !rows.length ? (
              <Empty title="No active Sales Admins" hint="Add Sales Admin users before setting targets." />
            ) : (
              <>
                {locked && <Notice tone="warn" className="m-4 mb-0">{label} is locked. Unlock the period to change its targets.</Notice>}
                {formError && <div className="p-4 pb-0"><ErrorNote error={formError} /></div>}
                <div className={cx('overflow-x-auto', loading && 'opacity-60')}>
                  <table className="mt-3 w-full min-w-[820px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <th scope="col" className="sticky left-0 z-10 border-y border-slate-200 bg-slate-50 px-4 py-2.5">Sales Admin</th>
                        {FIELDS.map((f) => <th key={f} scope="col" className="border-y border-slate-200 px-2 py-2.5 text-right">{LABELS[f]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.sales_admin_id} className="border-b border-slate-100">
                          <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-normal">
                            <span className="block whitespace-nowrap font-semibold text-brand-950">{r.name}</span>
                            <span className="block whitespace-nowrap text-xs text-slate-500">{[r.branch, r.login_id].filter(Boolean).join(' · ')}</span>
                          </th>
                          {FIELDS.map((f) => {
                            const v = grid[r.sales_admin_id]?.[f] ?? ''
                            return (
                              <td key={f} className="px-2 py-2">
                                <input type="number" min={0} step={WHOLE.includes(f) ? 1 : 'any'} inputMode="decimal" value={v} placeholder="0" disabled={locked}
                                  aria-label={`${LABELS[f]} target for ${r.name}`} onChange={(e) => setCell(r.sales_admin_id, f, e.target.value)}
                                  className={cx('h-9 w-full min-w-[92px] rounded-lg border bg-white px-2.5 text-right text-sm tabular focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500',
                                    bad(v) ? 'border-red-400 bg-red-50/40' : 'border-slate-300')} />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-brand-950">
                        <th scope="row" className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left">Total ({rows.length})</th>
                        {FIELDS.map((f) => <td key={f} className="px-4 py-3 text-right tabular">{num(totals[f])}</td>)}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </Card>
          <p className="mt-3 text-xs text-slate-500">
            Quarterly and yearly targets are the sum of the monthly targets. Lock a period after the 5th day of the next month, once all entries are in.
          </p>
        </div>

        <Card title="Locked periods" subtitle="Entries in a locked period cannot be changed">
          {!data?.locks?.length ? <p className="text-sm text-slate-500">No period is locked.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.locks.map((l) => (
                <li key={`${l.year}-${l.month}`}>
                  <button type="button" onClick={() => { setYear(l.year); setMonth(l.month) }}
                    className={cx('flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-2 text-left text-sm hover:bg-brand-50', l.year === year && l.month === month && 'bg-brand-50')}>
                    <span className="flex items-center gap-2 font-semibold text-brand-950"><Lock className="h-3.5 w-3.5 text-slate-500" />{MONTH_NAMES[l.month - 1]} {l.year}</span>
                    <StatusBadge status="Locked" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Only a month that has ended can be locked. Unlocking needs a reason and is recorded in the audit log.</p>
        </Card>
      </div>

      <Modal open={!!importErrors} onClose={() => setImportErrors(null)} title="Targets were not saved" size="lg"
        footer={<Button onClick={() => setImportErrors(null)}>Close</Button>}>
        <ErrorNote error={importErrors?.message} />
        <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
          {importErrors?.rows.map((r, i) => <li key={i} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">{r}</li>)}
        </ul>
      </Modal>
    </div>
  )
}
