// X3 Users and Roles: add, edit, activate and deactivate users; grant the cost-entry permission.
import { ChevronDown, LogIn, Pencil, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, ErrorNote, Field, Input, Modal, Notice, PageHeader, Pill, Select, Spinner, StatusBadge, cx, errText, useLoad, useUi } from '../../components/ui'
import { api } from '../../lib/api'
import { useNavigate } from 'react-router-dom'
import { homeFor, useAuth, type Role } from '../../lib/auth'

interface UserRow {
  id: number
  login_id: string
  name: string
  role: Role
  phone?: string
  designation?: string
  branch_id?: number
  branch?: string
  active: boolean
  cost_permission: boolean
  cost_granted?: boolean
}
interface Branch { id: number; code: string; name: string; active: boolean }

// exact role names from backend/app/core.py ROLES
const ROLES: Role[] = ['Super Admin', 'Sales Admin', 'Production Manager', 'Assistant Production Manager', 'Store Operator', 'Saw-Mill Supervisor', 'Warehouse / Delivery']
const ROLE_SHORT: Record<Role, string> = {
  'Super Admin': 'Super Admin', 'Sales Admin': 'Sales Admin', 'Production Manager': 'Production Manager', 'Assistant Production Manager': 'APM',
  'Store Operator': 'Store Operator', 'Saw-Mill Supervisor': 'Saw-Mill Supervisor', 'Warehouse / Delivery': 'Warehouse / Delivery',
}
const NO_COST_TOGGLE: Role[] = ['Super Admin', 'Production Manager']

// capability -> cell text per role, in ROLES order ('' shows as a dash)
const MATRIX: [string, string[]][] = [
  ['Create and edit orders (before assignment)', ['View', 'Yes', 'View', '', '', '', '']],
  ['Assign or reassign site', ['View', '', 'Yes', '', '', '', '']],
  ['Add or deactivate APM, edit site mapping', ['Yes', '', 'Yes', '', '', '', '']],
  ['Submit store and wood requisitions', ['View', '', 'View', 'Own sites', '', '', '']],
  ['Process store requisitions', ['View', '', 'View', '', 'Yes', '', '']],
  ['Process wood requisitions', ['View', '', 'View', '', '', 'Yes', '']],
  ['Update production stages and QC', ['View', '', 'View', 'Own sites', '', '', '']],
  ['QC sign-off', ['View', '', 'Yes', 'Own sites', '', '', '']],
  ['Packed, Ready, Delivered', ['View', '', 'View', '', '', '', 'Yes']],
  ['Live monitor and all dashboards', ['Yes', 'Own branch', 'Yes', 'Own sites', '', '', '']],
  ['Users, roles and master data', ['Yes', '', '', '', '', '', '']],
  ['Enter and edit production costs', ['View; grants', '', 'Yes', '', '', '', '']],
  ['View Production Reports', ['Yes', 'Own branch (no cost)', 'Yes', 'Own sites (no cost)', '', '', '']],
  ['Enter own sales entries and leads', ['View', 'Own records', '', '', '', '', '']],
  ['Centralised Sales Dashboard, targets, period lock', ['Yes', '', '', '', '', '', '']],
]

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-brand-700' : 'bg-slate-300')}>
      <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}

interface Form { id?: number; name: string; login_id: string; password: string; role: Role | ''; branch_id: string; designation: string; phone: string; cost_granted: boolean }
const BLANK: Form = { name: '', login_id: '', password: '', role: '', branch_id: '', designation: '', phone: '', cost_granted: false }

function MatrixCell({ v }: { v: string }) {
  if (!v) return <span className="text-slate-300">—</span>
  const tone = v.startsWith('Yes') ? 'green' : v.startsWith('View') ? 'slate' : 'brand'
  return <Pill tone={tone}>{v}</Pill>
}

export default function Users() {
  const { toast, confirm } = useUi()
  const { user: me, impersonate } = useAuth()
  const nav = useNavigate()
  const users = useLoad<UserRow[]>(() => api.get('/users'))
  const meta = useLoad<{ branches: Branch[] }>(() => api.get('/meta'))
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [showMatrix, setShowMatrix] = useState(false)

  const rows = useMemo(() => (users.data ?? []).filter((u) => (!roleFilter || u.role === roleFilter)
    && (!statusFilter || (statusFilter === 'Active') === u.active)), [users.data, roleFilter, statusFilter])

  const openAdd = () => { setForm({ ...BLANK }); setErrors({}); setFormError('') }
  const openEdit = (u: UserRow) => {
    setForm({ id: u.id, name: u.name, login_id: u.login_id, password: '', role: u.role, branch_id: u.branch_id ? String(u.branch_id) : '', designation: u.designation ?? '', phone: u.phone ?? '', cost_granted: !!u.cost_granted })
    setErrors({}); setFormError('')
  }
  const patch = (p: Partial<Form>) => { setForm((f) => (f ? { ...f, ...p } : f)); setErrors((e) => { const n = { ...e }; Object.keys(p).forEach((k) => delete n[k]); return n }) }

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form) return
    const isNew = !form.id
    const err: Record<string, string> = {}
    if (form.name.trim().length < 2) err.name = 'Please enter the name (at least 2 characters).'
    if (isNew && form.login_id.trim().length < 3) err.login_id = 'Please enter a User ID (at least 3 characters).'
    if (isNew && !form.password) err.password = 'Please enter a password.'
    else if (form.password && form.password.length < 6) err.password = 'The password must be at least 6 characters.'
    if (!form.role) err.role = 'Please select a role.'
    if (form.role === 'Sales Admin' && !form.branch_id) err.branch_id = "Please select the Sales Admin's branch."
    setErrors(err)
    if (Object.keys(err).length) return
    const costAllowed = !!form.role && !NO_COST_TOGGLE.includes(form.role)
    const body = {
      name: form.name.trim(), login_id: form.login_id.trim(), password: form.password || undefined, role: form.role,
      branch_id: form.role === 'Sales Admin' ? +form.branch_id : null,
      designation: form.designation.trim(), phone: form.phone.trim(), cost_granted: costAllowed && form.cost_granted,
    }
    setSaving(true); setFormError('')
    try {
      const res = isNew ? await api.post('/users', body) : await api.put(`/users/${form.id}`, body)
      toast.success(res.message ?? 'User saved.')
      setForm(null)
      users.reload()
    } catch (ex) { setFormError(errText(ex)) } finally { setSaving(false) }
  }

  const openAccount = async (u: UserRow) => {
    const ok = await confirm({ title: `Sign in as ${u.name}?`, confirmLabel: 'Open account',
      message: <>You will see and use Athena OS exactly as <b>{u.name}</b> ({u.role}). Everything you do is recorded under that account and in the audit log. Use <b>Return to Super Admin</b> at the top of the screen to come back.</> })
    if (!ok) return
    setBusyId(-u.id)
    try {
      const nu = await impersonate(u.id)
      toast.success(`You are now using Athena OS as ${u.name}.`)
      nav(homeFor(nu.role))
    } catch (e) { toast.error(errText(e)) } finally { setBusyId(null) }
  }

  const setActive = async (u: UserRow, active: boolean) => {
    const ok = await confirm(active
      ? { title: `Activate ${u.name}?`, message: `${u.name} (${u.login_id}) will be able to sign in again as ${u.role}.`, confirmLabel: 'Activate', tone: 'success' }
      : {
        title: `Deactivate ${u.name}?`, confirmLabel: 'Deactivate', tone: 'danger',
        message: <>{u.name} ({u.login_id}) will be signed out at once and can no longer sign in. Their records stay in the system.{u.role === 'Assistant Production Manager' && ' Sites mapped to this APM will be left without an APM.'}</>,
      })
    if (!ok) return
    setBusyId(u.id)
    try {
      const res = await api.post(`/users/${u.id}/active`, { active })
      toast.success(res.message ?? 'Saved.')
      users.reload()
    } catch (ex) { toast.error(errText(ex)) } finally { setBusyId(null) }
  }

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', render: (u) => <span className="font-semibold text-brand-950">{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}</span> },
    { key: 'login_id', header: 'User ID' },
    { key: 'role', header: 'Role', render: (u) => <Pill tone={u.role === 'Super Admin' ? 'gold' : 'brand'}>{u.role}</Pill> },
    { key: 'branch', header: 'Branch' },
    { key: 'designation', header: 'Designation' },
    { key: 'phone', header: 'Phone' },
    {
      key: 'cost', header: 'Cost-entry permission', always: true,
      value: (u) => (u.role === 'Production Manager' ? 'Yes (by role)' : u.cost_permission ? 'Yes (granted)' : u.role === 'Super Admin' ? 'View only' : 'No'),
      render: (u) => (u.role === 'Production Manager' ? <Pill tone="green">Yes · by role</Pill>
        : u.cost_permission ? <Pill tone="gold">Yes · granted</Pill>
          : u.role === 'Super Admin' ? <Pill>View only</Pill> : <span className="text-slate-400">No</span>),
    },
    { key: 'active', header: 'Status', always: true, value: (u) => (u.active ? 'Active' : 'Inactive'), render: (u) => <StatusBadge status={u.active ? 'Active' : 'Inactive'} /> },
    {
      key: 'actions', header: 'Actions', noExport: true, align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(u)}>Edit</Button>
          {u.active && u.id !== me?.id && <Button variant="secondary" size="sm" icon={<LogIn className="h-3.5 w-3.5" />} loading={busyId === -u.id} onClick={() => openAccount(u)}>Sign in as</Button>}
          {u.id !== me?.id && (u.active
            ? <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" icon={<UserX className="h-3.5 w-3.5" />} loading={busyId === u.id} onClick={() => setActive(u, false)}>Deactivate</Button>
            : <Button variant="ghost" size="sm" className="text-emerald-700 hover:bg-emerald-50" icon={<UserCheck className="h-3.5 w-3.5" />} loading={busyId === u.id} onClick={() => setActive(u, true)}>Activate</Button>)}
        </div>
      ),
    },
  ]

  const branches = (meta.data?.branches ?? []).filter((b) => b.active || String(b.id) === form?.branch_id)
  const costApplicable = !!form?.role && !NO_COST_TOGGLE.includes(form.role)

  return (
    <div>
      <PageHeader title="Users and Roles" subtitle="Who can sign in, what each person may do, and who may enter production costs."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={openAdd}>Add user</Button>} />

      <ErrorNote error={users.error} className="mb-4" />
      {users.loading && !users.data ? <Spinner label="Loading users…" /> : users.data && (
        <DataTable<UserRow> rows={rows} columns={columns} rowKey={(u) => u.id} exportName="Users" searchPlaceholder="Search name, user ID, role…"
          initialSort={{ key: 'name', dir: 'asc' }} emptyTitle="No users found" emptyHint="Change the role or status filter, or add a user."
          rowClassName={(u) => (u.active ? undefined : 'bg-slate-50/70 text-slate-500')}
          filters={<>
            <div className="w-[calc(50%-0.25rem)] sm:w-56">
              <Select aria-label="Role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-9">
                <option value="">All roles</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-36">
              <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9">
                <option value="">All statuses</option>
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>
          </>} />
      )}

      <section className="mt-5 rounded-xl border border-slate-200 bg-white shadow-card">
        <button type="button" aria-expanded={showMatrix} onClick={() => setShowMatrix((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><ShieldCheck className="h-5 w-5" /></span>
            <span>
              <span className="block text-[15px] font-bold text-brand-950">Permission matrix</span>
              <span className="block text-xs text-slate-500">Reference: what each of the seven roles can do</span>
            </span>
          </span>
          <ChevronDown className={cx('h-5 w-5 shrink-0 text-slate-500 transition-transform', showMatrix && 'rotate-180')} />
        </button>
        {showMatrix && (
          <div className="border-t border-slate-100">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th scope="col" className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-2.5">Capability</th>
                    {ROLES.map((r) => <th key={r} scope="col" className="border-b border-slate-200 px-3 py-2.5 text-center">{ROLE_SHORT[r]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {MATRIX.map(([cap, cells]) => (
                    <tr key={cap} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="sticky left-0 z-10 max-w-[13rem] bg-white px-4 py-2.5 text-left font-medium text-slate-800 sm:max-w-none">{cap}</th>
                      {cells.map((v, i) => <td key={ROLES[i]} className="px-3 py-2.5 text-center"><MatrixCell v={v} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              "View" means read-only access. "Own sites", "Own branch" and "Own records" limit a role to its own data. Cost entry is a permission the Super Admin grants to a user; it is not a role.
            </p>
          </div>
        )}
      </section>

      <Modal open={!!form} onClose={() => !saving && setForm(null)} title={form?.id ? `Edit user · ${form.login_id}` : 'Add user'} size="lg"
        footer={<>
          <Button variant="secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={() => save()}>{form?.id ? 'Save changes' : 'Add user'}</Button>
        </>}>
        {form && (
          <form onSubmit={save} className="space-y-4" noValidate>
            <ErrorNote error={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.name}>
                <Input value={form.name} invalid={!!errors.name} maxLength={100} autoFocus onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              {form.id ? (
                <Field label="User ID" hint="The User ID cannot be changed."><Input value={form.login_id} disabled readOnly /></Field>
              ) : (
                <Field label="User ID" required error={errors.login_id} hint="Used to sign in. 3 to 60 characters; saved in lower case.">
                  <Input value={form.login_id} invalid={!!errors.login_id} maxLength={60} autoComplete="off" onChange={(e) => patch({ login_id: e.target.value })} />
                </Field>
              )}
              <Field label={form.id ? 'Reset password' : 'Password'} required={!form.id} error={errors.password}
                hint={form.id ? 'Leave blank to keep the current password. At least 6 characters.' : 'At least 6 characters.'}>
                <Input type="password" value={form.password} invalid={!!errors.password} maxLength={60} autoComplete="new-password" onChange={(e) => patch({ password: e.target.value })} />
              </Field>
              <Field label="Role" required error={errors.role}>
                <Select value={form.role} invalid={!!errors.role} onChange={(e) => patch({ role: e.target.value as Role })}>
                  <option value="">Select a role</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              {form.role === 'Sales Admin' && (
                <Field label="Branch" required error={errors.branch_id} hint="A Sales Admin works with the orders and sales records of this branch only.">
                  <Select value={form.branch_id} invalid={!!errors.branch_id} onChange={(e) => patch({ branch_id: e.target.value })}>
                    <option value="">Select a branch</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Designation"><Input value={form.designation} maxLength={100} onChange={(e) => patch({ designation: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.phone} maxLength={30} inputMode="tel" onChange={(e) => patch({ phone: e.target.value })} /></Field>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-brand-950">Cost-entry permission</p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Lets this user enter and edit production cost lines. This is a permission, not a role. Production Managers have it by default.
                  </p>
                </div>
                <Toggle label="Cost-entry permission" checked={form.role === 'Production Manager' || (costApplicable && form.cost_granted)} disabled={!costApplicable} onChange={(v) => patch({ cost_granted: v })} />
              </div>
              {form.role === 'Production Manager' && <Notice className="mt-3">Production Managers can always enter and edit production costs.</Notice>}
              {form.role === 'Super Admin' && <Notice className="mt-3">Not applicable: the Super Admin views costs and grants this permission to others.</Notice>}
            </div>
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
    </div>
  )
}
