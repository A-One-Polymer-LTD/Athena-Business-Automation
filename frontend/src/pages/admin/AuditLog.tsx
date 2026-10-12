// X5 Audit Log: every change, who made it and when (FR-SA-06).
import { RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, ErrorNote, Field, Input, Notice, PageHeader, Pill, Select, Spinner, useLoad } from '../../components/ui'
import { api, qs } from '../../lib/api'
import { fmtDateTime, num } from '../../lib/format'

interface Entry { id: number; at: string; user?: string; role?: string; action: string; entity: string; ref?: string; detail?: string }

const LIMIT = 2000
const RED = ['ACCESS_DENIED', 'CANCEL', 'DEACTIVATE']
const actionTone = (a: string): 'red' | 'orange' | 'brand' => (RED.includes(a) ? 'red' : a === 'WARNING' ? 'orange' : 'brand')
const actionLabel = (a: string) => a.replace(/_/g, ' ')

export default function AuditLog() {
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [actions, setActions] = useState<string[]>(['ACCESS_DENIED'])
  const [refreshing, setRefreshing] = useState(false)

  // the search runs on the server so that it covers the whole log, not only the newest rows
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const badDates = !!from && !!to && from > to
  const { data, loading, error, reload } = useLoad<Entry[]>(
    () => api.get<Entry[]>(`/audit${qs({ q, action, date_from: from, date_to: to })}`).finally(() => setRefreshing(false)),
    [q, action, from, to],
  )

  // action options: every action seen so far, plus ACCESS_DENIED
  useEffect(() => {
    if (!data) return
    setActions((prev) => {
      const next = new Set(prev)
      data.forEach((e) => next.add(e.action))
      return next.size === prev.length ? prev : [...next].sort()
    })
  }, [data])

  const anyFilter = !!(action || from || to || search)
  const clear = () => { setAction(''); setFrom(''); setTo(''); setSearch('') }

  const columns: Column<Entry>[] = [
    { key: 'at', header: 'Date & time', sortable: false, value: (e) => fmtDateTime(e.at), render: (e) => <span className="whitespace-nowrap tabular">{fmtDateTime(e.at)}</span> },
    { key: 'user', header: 'User', render: (e) => (e.user ? <span className="font-medium text-brand-950">{e.user}</span> : null) },
    { key: 'role', header: 'Role' },
    { key: 'action', header: 'Action', render: (e) => <Pill tone={actionTone(e.action)}>{actionLabel(e.action)}</Pill> },
    { key: 'entity', header: 'Record type' },
    { key: 'ref', header: 'Reference', render: (e) => (e.ref ? <span className="tabular font-semibold text-brand-800">{e.ref}</span> : null) },
    { key: 'detail', header: 'Details', className: 'min-w-[16rem] max-w-md whitespace-normal' },
  ]

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Records are never hard-deleted; every change is traceable to a user and time."
        actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={refreshing} onClick={() => { setRefreshing(true); reload() }}>Refresh</Button>} />

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Search" className="col-span-2 lg:col-span-1">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User, reference, record type, details…" aria-label="Search the audit log" />
          </Field>
          <Field label="Action" className="col-span-2 lg:col-span-1">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </Select>
          </Field>
          <Field label="Date from" error={badDates ? 'After the "to" date.' : undefined}>
            <Input type="date" value={from} max={to || undefined} invalid={badDates} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Date to">
            <Input type="date" value={to} min={from || undefined} invalid={badDates} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {anyFilter && <div className="mt-3"><Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={clear}>Clear filters</Button></div>}
      </Card>

      <ErrorNote error={error} className="mb-4" />
      {data && data.length >= LIMIT && (
        <Notice tone="warn" className="mb-4">Showing the newest {num(LIMIT)} entries that match. Narrow the dates or add a filter to see older entries.</Notice>
      )}
      {loading && !data ? <Spinner label="Loading audit log…" /> : data && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <DataTable<Entry> rows={data} columns={columns} rowKey={(e) => e.id} searchable={false} exportName="Audit Log" pageSize={25}
            filters={<span className="text-xs text-slate-500">{num(data.length)} entr{data.length === 1 ? 'y' : 'ies'}, newest first</span>}
            emptyTitle="No audit entries match" emptyHint="Change or clear the filters to see more entries." />
        </div>
      )}
    </div>
  )
}
