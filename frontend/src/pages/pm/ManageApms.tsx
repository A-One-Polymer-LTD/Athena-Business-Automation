// P4 Manage APMs: add Assistant Production Managers, map sites to them, deactivate.
import { Pencil, UserPlus, UserX } from 'lucide-react'
import { useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Button, ErrorNote, Field, Input, Modal, Notice, PageHeader, Pill, Spinner, StatusBadge, cx, errText, useLoad, useUi,
} from '../../components/ui'
import { api } from '../../lib/api'

interface Apm { id: number; name: string; login_id: string; phone?: string; active: boolean; sites: { id: number; code: string; name: string }[]; open_items?: number }
interface Site { id: number; code: string; name: string; type?: string; active: boolean; apm_id?: number; apm?: string; open_items?: number }
interface Form { name: string; phone: string; login_id: string; password: string; site_ids: number[] }

const blank: Form = { name: '', phone: '', login_id: '', password: '', site_ids: [] }

export default function ManageApms() {
  const { toast, confirm } = useUi()
  const apms = useLoad<Apm[]>(() => api.get('/apms'))
  const meta = useLoad<{ sites: Site[] }>(() => api.get('/meta'))
  /** null = closed, 'new' = add, otherwise the APM being edited */
  const [editing, setEditing] = useState<Apm | 'new' | null>(null)
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(0)

  const isNew = editing === 'new'
  const editId = editing && editing !== 'new' ? editing.id : 0
  const sites = (meta.data?.sites ?? []).filter((s) => s.active || form.site_ids.includes(s.id))
  const reloadAll = () => { apms.reload(); meta.reload() }

  const open = (a: Apm | 'new') => {
    setForm(a === 'new' ? blank : { name: a.name, phone: a.phone ?? '', login_id: a.login_id, password: '', site_ids: a.sites.map((s) => s.id) })
    setErrors({})
    setFormError('')
    setEditing(a)
    meta.reload()
  }
  const set = (k: keyof Form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })) }
  const toggleSite = (id: number) => setForm((f) => ({ ...f, site_ids: f.site_ids.includes(id) ? f.site_ids.filter((x) => x !== id) : [...f.site_ids, id] }))

  const save = async () => {
    const e: Record<string, string> = {}
    if (form.name.trim().length < 2) e.name = 'Please enter the name (at least 2 characters).'
    if (isNew) {
      if (form.login_id.trim().length < 3) e.login_id = 'Login ID must be at least 3 characters.'
      if (form.password.length < 6) e.password = 'Password must be at least 6 characters.'
    }
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    setFormError('')
    try {
      const r = isNew
        ? await api.post('/apms', { name: form.name.trim(), phone: form.phone.trim(), login_id: form.login_id.trim(), password: form.password, site_ids: form.site_ids })
        : await api.put(`/apms/${editId}`, { name: form.name.trim(), phone: form.phone.trim(), site_ids: form.site_ids })
      toast.success(r.message)
      setEditing(null)
      reloadAll()
    } catch (err) { setFormError(errText(err)) } finally { setSaving(false) }
  }

  const deactivate = async (a: Apm) => {
    const ok = await confirm({
      title: `Deactivate ${a.name}?`,
      message: <>They will no longer be able to sign in, and their sites will be left without an APM. Their name stays on past records. This cannot be done while they have open items.</>,
      confirmLabel: 'Deactivate', tone: 'danger',
    })
    if (!ok) return
    setBusyId(a.id)
    try {
      const r = await api.post(`/apms/${a.id}/deactivate`)
      toast.success(r.message)
      reloadAll()
    } catch (e) { toast.error(errText(e)) } finally { setBusyId(0) }
  }

  const columns: Column<Apm>[] = [
    { key: 'name', header: 'Name', render: (a) => <span className={cx('font-semibold', a.active ? 'text-brand-950' : 'text-slate-500')}>{a.name}</span> },
    { key: 'login_id', header: 'Login ID' },
    { key: 'phone', header: 'Phone' },
    {
      key: 'sites', header: 'Sites', value: (a) => a.sites.map((s) => s.code).join(', '),
      render: (a) => (a.sites.length ? <div className="flex max-w-xs flex-wrap gap-1">{a.sites.map((s) => <Pill key={s.id} tone="brand" className="!rounded-md">{s.code}</Pill>)}</div> : <span className="text-xs text-slate-400">No sites</span>),
    },
    { key: 'open_items', header: 'Open items', align: 'right', value: (a) => a.open_items ?? 0 },
    { key: 'status', header: 'Status', value: (a) => (a.active ? 'Active' : 'Inactive'), render: (a) => <StatusBadge status={a.active ? 'Active' : 'Inactive'} /> },
    {
      key: 'actions', header: 'Actions', noExport: true,
      render: (a) => (a.active ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => open(a)}>Edit sites</Button>
          <Button size="sm" variant="ghost" className="!text-red-600 hover:!bg-red-50" icon={<UserX className="h-3.5 w-3.5" />} loading={busyId === a.id} onClick={() => deactivate(a)}>Deactivate</Button>
        </div>
      ) : null),
    },
  ]

  return (
    <>
      <PageHeader title="Manage APMs" subtitle="Assistant Production Managers and the production sites they are responsible for."
        actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => open('new')}>Add APM</Button>} />
      <Notice className="mb-4">
        Each site has exactly one APM. Moving a site to another APM moves its open items with it. Deactivated APMs can no longer sign in, but their name stays on past records.
      </Notice>

      {apms.loading ? <Spinner /> : apms.error ? <ErrorNote error={apms.error} /> : (
        <DataTable rows={apms.data ?? []} columns={columns} rowKey={(a) => a.id} exportName="APMs" searchPlaceholder="Search name, login ID, site…"
          emptyTitle="No APMs yet" emptyHint="Add the first Assistant Production Manager and map sites to them."
          rowClassName={(a) => (a.active ? undefined : 'bg-slate-50/70')} />
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? `Edit ${editing.name}` : 'Add APM'} size="lg"
        footer={<>
          <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={save}>{isNew ? 'Add APM' : 'Save changes'}</Button>
        </>}>
        <ErrorNote error={formError} className="mb-4" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            <Input value={form.name} invalid={!!errors.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} inputMode="tel" maxLength={20} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          {isNew ? (
            <>
              <Field label="Login ID" required error={errors.login_id} hint="Used to sign in. Lower-case letters and numbers.">
                <Input value={form.login_id} invalid={!!errors.login_id} maxLength={60} autoComplete="off" onChange={(e) => set('login_id', e.target.value.toLowerCase())} />
              </Field>
              <Field label="Password" required error={errors.password} hint="At least 6 characters.">
                <Input type="password" value={form.password} invalid={!!errors.password} maxLength={60} autoComplete="new-password" onChange={(e) => set('password', e.target.value)} />
              </Field>
            </>
          ) : (
            <Field label="Login ID" className="sm:col-span-2"><Input value={form.login_id} disabled /></Field>
          )}
        </div>

        <p className="mb-1.5 mt-5 text-[13px] font-semibold text-slate-700">Sites</p>
        <p className="mb-3 text-xs text-slate-500">
          Ticking a site that belongs to another APM moves it, with its open items, to this APM.
          {!isNew && ' A site with open items cannot be left without an APM — map it to another APM instead of unticking it.'}
        </p>
        {meta.loading && !meta.data ? <Spinner label="Loading sites…" /> : meta.error ? <ErrorNote error={meta.error} /> : sites.length === 0 ? (
          <p className="text-sm text-slate-500">No active sites are set up yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {sites.map((s) => {
              const on = form.site_ids.includes(s.id)
              const mine = !!editId && s.apm_id === editId
              const moves = on && !mine && !!s.apm
              return (
                <label key={s.id} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition', on ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
                  <input type="checkbox" checked={on} onChange={() => toggleSite(s.id)} className="mt-0.5 h-5 w-5 rounded border-slate-300 accent-brand-800" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-brand-950">{s.code} — {s.name}</span>
                    <span className="block text-xs text-slate-500">
                      {mine ? 'Currently this APM' : s.apm ? `Currently ${s.apm}` : 'No APM at present'} · {s.open_items ?? 0} open item{s.open_items === 1 ? '' : 's'}
                    </span>
                    {moves && <span className="mt-0.5 block text-xs font-medium text-orange-700">Will move from {s.apm}{s.open_items ? ` with ${s.open_items} open item${s.open_items === 1 ? '' : 's'}` : ''}.</span>}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </Modal>
    </>
  )
}
