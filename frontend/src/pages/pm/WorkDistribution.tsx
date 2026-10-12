// P2 Work Distribution: balance unassigned items across production sites.
import { CheckCircle2, Repeat, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthImage } from '../../components/AuthImage'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, Card, Empty, ErrorNote, Notice, PageHeader, Pill, SectionTitle, Select, Spinner, cx, errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDate } from '../../lib/format'

interface Item {
  id: number
  item_no: string
  order_id: number
  customer: string
  product_code?: string
  product_name?: string
  category?: string
  order_date: string
  promised_date?: string
  upholstery_needed?: boolean
  image?: string
  site_id?: number
  site?: string
  site_name?: string
  apm?: string
  stage_since?: string
}
interface Site { id: number; code: string; name: string; type?: string; active: boolean; apm?: string; open_items?: number }

const siteLabel = (s: Site) =>
  `${s.code} — ${s.name} · ${s.apm ?? 'No APM mapped'} · ${s.open_items ?? 0} open item${s.open_items === 1 ? '' : 's'}`

export default function WorkDistribution() {
  const { toast, confirm } = useUi()
  const { refreshBadges } = useAuth()
  const waiting = useLoad<Item[]>(() => api.get('/items?scope=unassigned'))
  const recent = useLoad<Item[]>(() => api.get('/items?scope=production&stage=Assigned'))
  const meta = useLoad<{ sites: Site[] }>(() => api.get('/meta'))

  const [pick, setPick] = useState<Record<number, string>>({})
  const [move, setMove] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [bulkSite, setBulkSite] = useState('')
  const [busy, setBusy] = useState('')

  const sites = useMemo(() => (meta.data?.sites ?? []).filter((s) => s.active), [meta.data])
  const loads = sites.map((s) => s.open_items ?? 0)
  const min = Math.min(...loads), max = Math.max(...loads)
  const items = waiting.data ?? []
  const selected = items.filter((i) => checked.has(i.id))
  const bulkTarget = sites.find((s) => String(s.id) === bulkSite)

  const reloadAll = () => { waiting.reload(); recent.reload(); meta.reload(); refreshBadges() }
  const toggle = (id: number) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const assignOne = async (it: Item) => {
    const site_id = Number(pick[it.id])
    if (!site_id) { toast.warn('Please select a site for this item first.'); return }
    setBusy(`assign-${it.id}`)
    try {
      const r = await api.post(`/items/${it.id}/assign`, { site_id })
      toast.success(r.message)
      reloadAll()
    } catch (e) { toast.error(errText(e)) } finally { setBusy('') }
  }

  const assignSelected = async () => {
    if (!bulkTarget || !selected.length) return
    const ok = await confirm({
      title: `Assign ${selected.length} item${selected.length === 1 ? '' : 's'} to ${bulkTarget.code}?`,
      message: `They will appear on ${bulkTarget.apm ?? 'the APM'}'s work list straight away.`,
      confirmLabel: 'Assign',
    })
    if (!ok) return
    setBusy('bulk')
    let done = 0
    const failed: string[] = []
    for (const it of selected) {
      try { await api.post(`/items/${it.id}/assign`, { site_id: bulkTarget.id }); done += 1 }
      catch (e) { failed.push(`${it.item_no}: ${errText(e)}`) }
    }
    if (done) toast.success(`${done} item${done === 1 ? '' : 's'} assigned to ${bulkTarget.code}${bulkTarget.apm ? `. Now on ${bulkTarget.apm}'s work list.` : '.'}`)
    failed.forEach((f) => toast.error(f))
    setChecked(new Set())
    setBusy('')
    reloadAll()
  }

  const reassign = async (it: Item) => {
    const target = sites.find((s) => String(s.id) === move[it.id])
    if (!target) { toast.warn('Please select the new site first.'); return }
    const ok = await confirm({
      title: `Reassign ${it.item_no}?`,
      message: `Move this item from ${it.site ?? 'its current site'} to ${target.code}${target.apm ? ` (${target.apm})` : ''}.`,
      confirmLabel: 'Reassign', tone: 'warn',
    })
    if (!ok) return
    setBusy(`move-${it.id}`)
    try {
      const r = await api.post(`/items/${it.id}/assign`, { site_id: target.id })
      toast.success(r.message)
      setMove((m) => ({ ...m, [it.id]: '' }))
      reloadAll()
    } catch (e) { toast.error(errText(e)) } finally { setBusy('') }
  }

  const thumb: Column<Item> = {
    key: 'image', header: '', noExport: true,
    render: (i) => <AuthImage file={i.image} alt={i.product_name} className="h-12 w-14 rounded-lg border border-slate-200" />,
  }
  const base: Column<Item>[] = [
    { key: 'item_no', header: 'Item No.', render: (i) => <Link to={`/items/${i.id}`} className="font-semibold text-brand-800 hover:underline">{i.item_no}</Link> },
    {
      key: 'product_name', header: 'Product',
      render: (i) => <div><p className="font-medium text-brand-950">{i.product_name}</p>{(i.product_code || i.category) && <p className="text-xs text-slate-500">{[i.product_code, i.category].filter(Boolean).join(' · ')}</p>}</div>,
    },
    { key: 'customer', header: 'Customer' },
    { key: 'order_date', header: 'Order date', render: (i) => fmtDate(i.order_date) },
    { key: 'promised_date', header: 'Promised', render: (i) => (i.promised_date ? fmtDate(i.promised_date) : null) },
    { key: 'upholstery', header: 'Upholstery', value: (i) => (i.upholstery_needed ? 'Yes' : ''), render: (i) => (i.upholstery_needed ? <Pill tone="gold">Upholstery</Pill> : null) },
  ]

  const waitingColumns: Column<Item>[] = [
    {
      key: 'select', header: 'Select', noExport: true,
      render: (i) => <input type="checkbox" aria-label={`Select ${i.item_no}`} checked={checked.has(i.id)} onChange={() => toggle(i.id)} className="h-5 w-5 cursor-pointer rounded border-slate-300 accent-brand-800" />,
    },
    thumb, ...base,
    {
      key: 'site_pick', header: 'Assign to site', noExport: true,
      render: (i) => (
        <div className="flex items-center gap-2">
          <div className="w-72">
            <Select aria-label={`Site for ${i.item_no}`} value={pick[i.id] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [i.id]: e.target.value }))}>
              <option value="">Select a site…</option>
              {sites.map((s) => <option key={s.id} value={s.id} disabled={!s.apm}>{siteLabel(s)}</option>)}
            </Select>
          </div>
          <Button size="sm" className="!h-10" icon={<Send className="h-4 w-4" />} loading={busy === `assign-${i.id}`} disabled={!!busy || !pick[i.id]} onClick={() => assignOne(i)}>Assign</Button>
        </div>
      ),
    },
  ]

  const recentColumns: Column<Item>[] = [
    thumb, ...base,
    { key: 'site', header: 'Current site', render: (i) => <div><p className="font-semibold text-brand-950">{i.site}</p>{i.site_name && <p className="text-xs text-slate-500">{i.site_name}</p>}</div> },
    { key: 'apm', header: 'APM' },
    { key: 'stage_since', header: 'Assigned on', render: (i) => (i.stage_since ? fmtDate(i.stage_since) : null) },
    {
      key: 'reassign', header: 'Reassign to', noExport: true,
      render: (i) => (
        <div className="flex items-center gap-2">
          <div className="w-72">
            <Select aria-label={`New site for ${i.item_no}`} value={move[i.id] ?? ''} onChange={(e) => setMove((m) => ({ ...m, [i.id]: e.target.value }))}>
              <option value="">Select another site…</option>
              {sites.filter((s) => s.id !== i.site_id).map((s) => <option key={s.id} value={s.id} disabled={!s.apm}>{siteLabel(s)}</option>)}
            </Select>
          </div>
          <Button size="sm" variant="secondary" className="!h-10" icon={<Repeat className="h-4 w-4" />} loading={busy === `move-${i.id}`} disabled={!!busy || !move[i.id]} onClick={() => reassign(i)}>Reassign</Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Work Distribution" subtitle="Assign waiting items to production sites and keep the load balanced between sites and APMs." />

      {meta.loading ? <Spinner label="Loading sites…" /> : meta.error ? <ErrorNote error={meta.error} /> : sites.length === 0 ? (
        <Notice tone="warn">No active production sites are set up yet.</Notice>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          {sites.map((s) => {
            const n = s.open_items ?? 0
            const least = max !== min && n === min, most = max !== min && n === max
            return (
              <div key={s.id} className={cx('rounded-xl border bg-white p-4 shadow-card', least ? 'border-emerald-300 ring-2 ring-emerald-100' : most ? 'border-orange-300 ring-2 ring-orange-100' : 'border-slate-200')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-base font-bold text-brand-950">{s.code}</p>
                    <p className="truncate text-xs text-slate-500">{s.name}</p>
                  </div>
                  {s.type && <Pill tone={s.type === 'Contract' ? 'gold' : 'brand'}>{s.type}</Pill>}
                </div>
                <p className="mt-3 font-display text-3xl font-bold tabular text-brand-950">{n}</p>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">open item{n === 1 ? '' : 's'}</p>
                <p className={cx('mt-2 truncate text-xs font-medium', s.apm ? 'text-slate-700' : 'text-red-600')}>{s.apm ? `APM: ${s.apm}` : 'No APM mapped'}</p>
                {(least || most) && <Pill tone={least ? 'green' : 'orange'} className="mt-2">{least ? 'Least loaded' : 'Most loaded'}</Pill>}
              </div>
            )
          })}
        </div>
      )}

      <SectionTitle>Waiting for assignment</SectionTitle>
      {waiting.loading ? <Spinner /> : waiting.error ? <ErrorNote error={waiting.error} /> : items.length === 0 ? (
        <Card><Empty icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing is waiting" hint="Every item of every placed order has been assigned to a production site." /></Card>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3 sm:flex-row sm:items-center">
            <p className="text-sm font-semibold text-brand-900 sm:w-44">{selected.length} of {items.length} selected</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setChecked(new Set(items.map((i) => i.id)))} disabled={selected.length === items.length}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())} disabled={!selected.length}>Clear</Button>
            </div>
            <div className="min-w-0 flex-1 sm:max-w-md">
              <Select aria-label="Site for the selected items" value={bulkSite} onChange={(e) => setBulkSite(e.target.value)}>
                <option value="">Select a site for the selected items…</option>
                {sites.map((s) => <option key={s.id} value={s.id} disabled={!s.apm}>{siteLabel(s)}</option>)}
              </Select>
            </div>
            <Button icon={<Send className="h-4 w-4" />} loading={busy === 'bulk'} disabled={!!busy || !selected.length || !bulkTarget} onClick={assignSelected}>
              Assign selected{bulkTarget ? ` to ${bulkTarget.code}` : ''}
            </Button>
          </div>
          <DataTable rows={items} columns={waitingColumns} rowKey={(i) => i.id} exportName="Unassigned items"
            searchPlaceholder="Search item, product, customer…" rowClassName={(i) => (checked.has(i.id) ? 'bg-brand-50/70' : undefined)} />
        </>
      )}

      <SectionTitle>Recently assigned — reassign before Machine Room starts</SectionTitle>
      <Notice className="mb-3">
        An item can be moved to another site only while it is still at the <b>Assigned</b> stage. Once Machine Room starts, only the Super Admin can reassign it, with a reason.
      </Notice>
      {recent.loading ? <Spinner /> : recent.error ? <ErrorNote error={recent.error} /> : (
        <DataTable rows={recent.data ?? []} columns={recentColumns} rowKey={(i) => i.id} exportName="Recently assigned items"
          searchPlaceholder="Search item, product, site…" emptyTitle="No items at the Assigned stage" emptyHint="Items appear here after assignment until the APM starts Machine Room." />
      )}
    </>
  )
}
