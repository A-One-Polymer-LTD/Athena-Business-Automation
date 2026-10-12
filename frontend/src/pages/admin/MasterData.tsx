// X4 Master Data: products, materials, categories, wood, colours, sites and branches, with Excel import and export.
import { Download, Pencil, Plus, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, ErrorNote, Field, Input, Modal, Notice, PageHeader, Pill, Select, Spinner, StatusBadge, Tabs, cx, errText, useLoad, useUi } from '../../components/ui'
import { ApiError, api } from '../../lib/api'
import { downloadTemplate, readSheet } from '../../lib/export'
import { num } from '../../lib/format'

type Kind = 'product' | 'product_category' | 'material' | 'material_category' | 'wood' | 'seasoning' | 'colour'
type TabKey = Kind | 'sites' | 'branches'

interface KindDef {
  label: string
  singular: string
  /** required number of digits in the code */
  digits?: number
  codeHint: string
  codeOptional?: boolean
  /** master kind that supplies the category list */
  parent?: Kind
  unit?: boolean
  example: Record<string, string>
}
const KINDS: Record<Kind, KindDef> = {
  product: { label: 'Products', singular: 'Product', digits: 6, codeHint: 'Exactly 6 digits, e.g. 100045.', parent: 'product_category', example: { code: '100045', name: 'Classic Sofa Set (3+1+1)', category: 'Sofa' } },
  product_category: { label: 'Product Categories', singular: 'Product Category', digits: 2, codeHint: 'Exactly 2 digits, e.g. 10.', example: { code: '10', name: 'Sofa' } },
  material: { label: 'Raw Materials', singular: 'Raw Material', digits: 7, codeHint: 'Exactly 7 digits, e.g. 3020015.', parent: 'material_category', unit: true, example: { code: '3020015', name: 'Artificial Leather', category: 'Foam & Fabric', unit: 'yard' } },
  material_category: { label: 'Raw Material Categories', singular: 'Raw Material Category', digits: 3, codeHint: 'Exactly 3 digits, e.g. 302.', example: { code: '302', name: 'Foam & Fabric' } },
  wood: { label: 'Wood Categories', singular: 'Wood Category', codeHint: 'Optional. Left blank, the name is used as the code.', codeOptional: true, example: { code: 'Mahogany', name: 'Mahogany' } },
  seasoning: { label: 'Wood Seasoning', singular: 'Wood Seasoning', codeHint: 'Optional. Left blank, the name is used as the code.', codeOptional: true, example: { code: 'Seasonal', name: 'Seasonal' } },
  colour: { label: 'Colours', singular: 'Colour', codeHint: 'A short unique code, e.g. CL-220.', example: { code: 'CL-220', name: 'Antique White' } },
}
const TAB_OPTIONS: { value: TabKey; label: string }[] = [
  ...(Object.keys(KINDS) as Kind[]).map((k) => ({ value: k as TabKey, label: KINDS[k].label })),
  { value: 'sites', label: 'Sites' },
  { value: 'branches', label: 'Branches' },
]

function ActiveSwitch({ checked, onChange, onLabel, offLabel, hint }: { checked: boolean; onChange: (v: boolean) => void; onLabel: string; offLabel: string; hint: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
      <div>
        <p className="text-sm font-semibold text-brand-950">{checked ? onLabel : offLabel}</p>
        <p className="mt-0.5 text-xs text-slate-600">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={onLabel} onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-emerald-600' : 'bg-slate-300')}>
        <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </div>
  )
}

const editColumn = <T,>(onEdit: (r: T) => void): Column<T> => ({
  key: 'actions', header: 'Actions', noExport: true, align: 'right',
  render: (r) => <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(r)}>Edit</Button>,
})

// ---------------------------------------------------------------- master lists
interface MasterRow { id: number; kind: string; code: string; name: string; category?: string; unit?: string; active: boolean }
interface MasterForm { id?: number; code: string; name: string; category: string; unit: string; active: boolean }

function MasterList({ kind }: { kind: Kind }) {
  const def = KINDS[kind]
  const { toast } = useUi()
  const list = useLoad<MasterRow[]>(() => api.get(`/masters/${kind}`), [kind])
  const parents = useLoad<MasterRow[]>(() => (def.parent ? api.get(`/masters/${def.parent}`) : Promise.resolve([])), [kind])
  const [form, setForm] = useState<MasterForm | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState<{ message: string; rows: string[]; file: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const headers = ['code', 'name', ...(def.parent ? ['category'] : []), ...(def.unit ? ['unit'] : [])]
  const open = (r?: MasterRow) => {
    setForm(r ? { id: r.id, code: r.code, name: r.name, category: r.category ?? '', unit: r.unit ?? '', active: r.active } : { code: '', name: '', category: '', unit: '', active: true })
    setErrors({}); setFormError('')
  }
  const patch = (p: Partial<MasterForm>) => { setForm((f) => (f ? { ...f, ...p } : f)); setErrors((e) => { const n = { ...e }; Object.keys(p).forEach((k) => delete n[k]); return n }) }

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form) return
    const err: Record<string, string> = {}
    const code = form.code.trim()
    if (!form.name.trim()) err.name = 'Please enter the name.'
    if (!code && !def.codeOptional) err.code = 'Please enter the code.'
    else if (def.digits && !new RegExp(`^\\d{${def.digits}}$`).test(code)) err.code = `The code must be a ${def.digits}-digit number.`
    if (def.parent && !form.category) err.category = 'Please select a category.'
    setErrors(err)
    if (Object.keys(err).length) return
    setSaving(true); setFormError('')
    try {
      const res = await api.post(`/masters/${kind}`, { id: form.id, code, name: form.name.trim(), category: def.parent ? form.category : '', unit: def.unit ? form.unit.trim() : '', active: form.active })
      toast.success(res.message ?? 'Saved.')
      setForm(null)
      list.reload()
    } catch (ex) { setFormError(errText(ex)) } finally { setSaving(false) }
  }

  const onFile = async (file?: File) => {
    if (!file) return
    setImporting(true)
    try {
      let rows: Record<string, any>[]
      try { rows = await readSheet(file) } catch { throw new Error(`${file.name} could not be read. Please use the Excel template.`) }
      if (!rows.length) throw new Error('The file has no rows below the header.')
      if (!('name' in rows[0])) throw new Error(`The file has no "name" column. Please use the template (columns: ${headers.join(', ')}).`)
      const res = await api.post(`/masters/${kind}/import`, { rows: rows.map((r) => Object.fromEntries(headers.map((h) => [h, r[h] ?? '']))) })
      toast.success(res.message ?? 'Import complete.')
      list.reload()
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 422 && ex.rows?.length) setImportErr({ message: ex.message, rows: ex.rows, file: file.name })
      else toast.error(errText(ex))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const columns: Column<MasterRow>[] = [
    { key: 'code', header: 'Code', render: (r) => <span className="tabular font-semibold text-brand-800">{r.code}</span> },
    { key: 'name', header: 'Name', render: (r) => <span className={r.active ? 'font-medium text-brand-950' : 'text-slate-500'}>{r.name}</span> },
    { key: 'category', header: 'Category' },
    { key: 'unit', header: 'Unit' },
    { key: 'active', header: 'Status', always: true, value: (r) => (r.active ? 'Active' : 'Retired'), render: (r) => <StatusBadge status={r.active ? 'Active' : 'Retired'} /> },
    editColumn<MasterRow>(open),
  ]
  const categoryOptions = (parents.data ?? []).filter((p) => p.active || p.name === form?.category)
  const retired = (list.data ?? []).filter((r) => !r.active).length

  return (
    <>
      <ErrorNote error={list.error || parents.error} className="mb-4" />
      {list.loading && !list.data ? <Spinner label={`Loading ${def.label.toLowerCase()}…`} /> : list.data && (
        <DataTable<MasterRow> rows={list.data} columns={columns} rowKey={(r) => r.id} exportName={def.label} searchPlaceholder="Search code, name…"
          initialSort={{ key: 'code', dir: 'asc' }} emptyTitle={`No ${def.label.toLowerCase()} yet`} emptyHint="Add the first one, or import a list from Excel."
          rowClassName={(r) => (r.active ? undefined : 'bg-slate-50/70')}
          filters={<span className="text-xs text-slate-500">{num(list.data.length)} record{list.data.length === 1 ? '' : 's'}{retired ? ` · ${num(retired)} retired` : ''}</span>}
          actions={<>
            <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadTemplate(`${def.label} import template`, headers, headers.map((h) => def.example[h] ?? ''))}>Download template</Button>
            <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} loading={importing} onClick={() => fileRef.current?.click()}>Import from Excel</Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open()}>Add</Button>
          </>} />
      )}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <p className="mt-3 text-xs text-slate-500">
        Excel import adds new records only. Columns: {headers.join(', ')}. {def.digits ? `Codes must be ${def.digits}-digit numbers. ` : ''}If any row has an error, nothing is imported.
      </p>

      <Modal open={!!form} onClose={() => !saving && setForm(null)} title={`${form?.id ? 'Edit' : 'Add'} ${def.singular.toLowerCase()}`}
        footer={<>
          <Button variant="secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={() => save()}>Save</Button>
        </>}>
        {form && (
          <form onSubmit={save} className="space-y-4" noValidate>
            <ErrorNote error={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code" required={!def.codeOptional} error={errors.code} hint={def.codeHint}>
                <Input value={form.code} invalid={!!errors.code} maxLength={def.digits ?? 40} inputMode={def.digits ? 'numeric' : undefined} autoFocus onChange={(e) => patch({ code: e.target.value })} />
              </Field>
              <Field label="Name" required error={errors.name}>
                <Input value={form.name} invalid={!!errors.name} maxLength={150} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              {def.parent && (
                <Field label="Category" required error={errors.category} hint={`From the ${KINDS[def.parent].label} list.`}>
                  <Select value={form.category} invalid={!!errors.category} onChange={(e) => patch({ category: e.target.value })}>
                    <option value="">Select a category</option>
                    {categoryOptions.map((c) => <option key={c.id} value={c.name}>{c.name}{c.active ? '' : ' (retired)'}</option>)}
                  </Select>
                </Field>
              )}
              {def.unit && (
                <Field label="Unit" hint="Unit of measure, e.g. pcs, yard, litre, cft.">
                  <Input value={form.unit} maxLength={20} onChange={(e) => patch({ unit: e.target.value })} />
                </Field>
              )}
            </div>
            <ActiveSwitch checked={form.active} onChange={(v) => patch({ active: v })} onLabel="Active" offLabel="Retired"
              hint="Retired values stay on old records but can no longer be selected on new ones." />
            <button type="submit" hidden />
          </form>
        )}
      </Modal>

      <Modal open={!!importErr} onClose={() => setImportErr(null)} title="Import not completed" size="lg"
        footer={<Button onClick={() => setImportErr(null)}>Close</Button>}>
        {importErr && (
          <div className="space-y-3">
            <ErrorNote error={importErr.message} />
            <p className="text-sm text-slate-600">Correct these rows in <span className="font-semibold text-brand-950">{importErr.file}</span> and import the file again. Row 1 is the header row.</p>
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
              {importErr.rows.map((r, i) => <li key={i} className="px-3.5 py-2 text-slate-800">{r}</li>)}
            </ul>
          </div>
        )}
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------- sites
interface Site { id: number; code: string; name: string; type?: string; active: boolean; apm_id?: number; apm?: string; open_items: number }
interface Branch { id: number; code: string; name: string; active: boolean }
interface MetaData { sites: Site[]; branches: Branch[] }
interface Apm { id: number; name: string; active: boolean }
interface SiteForm { id?: number; code: string; name: string; type: 'In-house' | 'Contract'; apm_id: string; active: boolean; open_items: number }

function SitesList() {
  const { toast } = useUi()
  const meta = useLoad<MetaData>(() => api.get('/meta'))
  const apms = useLoad<Apm[]>(() => api.get('/apms'))
  const [form, setForm] = useState<SiteForm | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const open = (s?: Site) => {
    setForm(s ? { id: s.id, code: s.code, name: s.name, type: s.type === 'Contract' ? 'Contract' : 'In-house', apm_id: s.apm_id ? String(s.apm_id) : '', active: s.active, open_items: s.open_items }
      : { code: '', name: '', type: 'In-house', apm_id: '', active: true, open_items: 0 })
    setErrors({}); setFormError('')
  }
  const patch = (p: Partial<SiteForm>) => { setForm((f) => (f ? { ...f, ...p } : f)); setErrors((e) => { const n = { ...e }; Object.keys(p).forEach((k) => delete n[k]); return n }) }

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form) return
    const err: Record<string, string> = {}
    if (form.code.trim().length < 2) err.code = 'Please enter the site code (at least 2 characters).'
    if (form.name.trim().length < 2) err.name = 'Please enter the site name.'
    setErrors(err)
    if (Object.keys(err).length) return
    setSaving(true); setFormError('')
    try {
      const res = await api.post('/sites', { id: form.id, code: form.code.trim(), name: form.name.trim(), type: form.type, apm_id: +form.apm_id || null, active: form.active })
      toast.success(res.message ?? 'Site saved.')
      setForm(null)
      meta.reload()
    } catch (ex) { setFormError(errText(ex)) } finally { setSaving(false) }
  }

  const columns: Column<Site>[] = [
    { key: 'code', header: 'Code', render: (s) => <span className="font-semibold text-brand-800">{s.code}</span> },
    { key: 'name', header: 'Name' },
    { key: 'type', header: 'Type', render: (s) => (s.type ? <Pill tone={s.type === 'Contract' ? 'gold' : 'brand'}>{s.type}</Pill> : null) },
    { key: 'apm', header: 'APM', always: true, render: (s) => s.apm ?? <span className="text-orange-700">Not mapped</span>, value: (s) => s.apm ?? 'Not mapped' },
    { key: 'open_items', header: 'Open items', align: 'right', always: true },
    { key: 'active', header: 'Status', always: true, value: (s) => (s.active ? 'Active' : 'Inactive'), render: (s) => <StatusBadge status={s.active ? 'Active' : 'Inactive'} /> },
    editColumn<Site>(open),
  ]
  const apmOptions = (apms.data ?? []).filter((a) => a.active || String(a.id) === form?.apm_id)

  return (
    <>
      <ErrorNote error={meta.error || apms.error} className="mb-4" />
      {meta.loading && !meta.data ? <Spinner label="Loading sites…" /> : meta.data && (
        <DataTable<Site> rows={meta.data.sites} columns={columns} rowKey={(s) => s.id} exportName="Sites" searchPlaceholder="Search code, name, APM…"
          emptyTitle="No sites yet" emptyHint="Add a production site and map it to an APM."
          actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open()}>Add site</Button>} />
      )}
      <p className="mt-3 text-xs text-slate-500">Each site is mapped to one APM. When the mapping changes, the open items move with the site.</p>

      <Modal open={!!form} onClose={() => !saving && setForm(null)} title={form?.id ? `Edit site · ${form.code}` : 'Add site'}
        footer={<>
          <Button variant="secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={() => save()}>Save</Button>
        </>}>
        {form && (
          <form onSubmit={save} className="space-y-4" noValidate>
            <ErrorNote error={formError} />
            {form.open_items > 0 && <Notice tone="warn">This site has {num(form.open_items)} open item{form.open_items === 1 ? '' : 's'}, so it must stay active and mapped to an APM.</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Site code" required error={errors.code} hint="2 to 20 characters, e.g. PS-07. Saved in capitals.">
                <Input value={form.code} invalid={!!errors.code} maxLength={20} autoFocus onChange={(e) => patch({ code: e.target.value })} />
              </Field>
              <Field label="Site name" required error={errors.name}>
                <Input value={form.name} invalid={!!errors.name} maxLength={100} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="Type" required>
                <Select value={form.type} onChange={(e) => patch({ type: e.target.value as SiteForm['type'] })}>
                  <option value="In-house">In-house</option>
                  <option value="Contract">Contract</option>
                </Select>
              </Field>
              <Field label="APM" hint="Only active APMs can be selected.">
                <Select value={form.apm_id} onChange={(e) => patch({ apm_id: e.target.value })}>
                  <option value="">Not mapped</option>
                  {apmOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            </div>
            <ActiveSwitch checked={form.active} onChange={(v) => patch({ active: v })} onLabel="Active" offLabel="Inactive"
              hint="Inactive sites stay on old records but can no longer receive new items." />
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------- branches
interface BranchForm { id?: number; code: string; name: string; active: boolean }

function BranchesList() {
  const { toast } = useUi()
  const meta = useLoad<MetaData>(() => api.get('/meta'))
  const [form, setForm] = useState<BranchForm | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const open = (b?: Branch) => { setForm(b ? { id: b.id, code: b.code, name: b.name, active: b.active } : { code: '', name: '', active: true }); setErrors({}); setFormError('') }
  const patch = (p: Partial<BranchForm>) => { setForm((f) => (f ? { ...f, ...p } : f)); setErrors((e) => { const n = { ...e }; Object.keys(p).forEach((k) => delete n[k]); return n }) }

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form) return
    const err: Record<string, string> = {}
    if (!form.code.trim()) err.code = 'Please enter the branch code.'
    if (form.name.trim().length < 2) err.name = 'Please enter the branch name.'
    setErrors(err)
    if (Object.keys(err).length) return
    setSaving(true); setFormError('')
    try {
      const res = await api.post('/branches', { id: form.id, code: form.code.trim(), name: form.name.trim(), active: form.active })
      toast.success(res.message ?? 'Branch saved.')
      setForm(null)
      meta.reload()
    } catch (ex) { setFormError(errText(ex)) } finally { setSaving(false) }
  }

  const columns: Column<Branch>[] = [
    { key: 'code', header: 'Code', render: (b) => <span className="font-semibold text-brand-800">{b.code}</span> },
    { key: 'name', header: 'Name' },
    { key: 'active', header: 'Status', always: true, value: (b) => (b.active ? 'Active' : 'Inactive'), render: (b) => <StatusBadge status={b.active ? 'Active' : 'Inactive'} /> },
    editColumn<Branch>(open),
  ]

  return (
    <>
      <ErrorNote error={meta.error} className="mb-4" />
      {meta.loading && !meta.data ? <Spinner label="Loading branches…" /> : meta.data && (
        <DataTable<Branch> rows={meta.data.branches} columns={columns} rowKey={(b) => b.id} exportName="Branches" searchPlaceholder="Search code, name…"
          emptyTitle="No branches yet" emptyHint="Add the first showroom branch."
          actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open()}>Add branch</Button>} />
      )}
      <p className="mt-3 text-xs text-slate-500">Branches are the showrooms. Each Sales Admin belongs to one branch and works with that branch's orders only.</p>

      <Modal open={!!form} onClose={() => !saving && setForm(null)} title={form?.id ? `Edit branch · ${form.code}` : 'Add branch'}
        footer={<>
          <Button variant="secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={() => save()}>Save</Button>
        </>}>
        {form && (
          <form onSubmit={save} className="space-y-4" noValidate>
            <ErrorNote error={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Branch code" required error={errors.code} hint="Up to 20 characters, e.g. BR-N. Saved in capitals.">
                <Input value={form.code} invalid={!!errors.code} maxLength={20} autoFocus onChange={(e) => patch({ code: e.target.value })} />
              </Field>
              <Field label="Branch name" required error={errors.name}>
                <Input value={form.name} invalid={!!errors.name} maxLength={100} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
            </div>
            <ActiveSwitch checked={form.active} onChange={(v) => patch({ active: v })} onLabel="Active" offLabel="Inactive"
              hint="Inactive branches stay on old records but can no longer be selected." />
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------- page
export default function MasterData() {
  const [tab, setTab] = useState<TabKey>('product')
  return (
    <div>
      <PageHeader title="Master Data" subtitle="The lists every form selects from. Retired values stay on old records but can no longer be selected." />
      <div className="mb-4 max-w-full overflow-x-auto pb-1">
        <Tabs<TabKey> value={tab} onChange={setTab} options={TAB_OPTIONS} className="sm:flex-nowrap" />
      </div>
      {tab === 'sites' ? <SitesList /> : tab === 'branches' ? <BranchesList /> : <MasterList key={tab} kind={tab} />}
    </div>
  )
}
