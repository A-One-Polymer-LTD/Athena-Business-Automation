// S2 New Customer Order form (also used to edit a draft, a returned order, or a placed order that is not assigned yet).
import { ArrowLeft, CheckCircle2, ImagePlus, Loader2, Plus, Search, Send, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AuthImage } from '../../components/AuthImage'
import { Button, Card, ErrorNote, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Tabs, Textarea, cx, errText, useLoad, useUi } from '../../components/ui'
import { ActingSalesAdminPicker, actingBody } from '../../lib/acting'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { currentSettings, money, todayISO } from '../../lib/format'

interface Master { code: string; name: string; category?: string }
interface Customer { id: number; code?: string; name: string; phone?: string; address?: string }
interface Img { file: string; name: string }
interface ItemDraft {
  uid: string
  product_code: string; product_name: string; category: string
  product_desc: string; design_desc: string
  height: string; width: string; length: string
  colour_code: string; wood_category: string; seasoning: string
  upholstery_needed: boolean; amount: string
  images: Img[]; uploading: number
}
interface LeadRef { id: number; customer_name?: string; customer_phone?: string }
type Errors = Record<string, string>
type ItemField = 'product_code' | 'product_desc' | 'design_desc' | 'height' | 'width' | 'length' | 'colour_code' | 'wood_category' | 'seasoning' | 'amount' | 'images'

const MAX_IMAGE = 5 * 1024 * 1024
const MAX_IMAGES = 10
const ITEM_FIELDS: ItemField[] = ['product_code', 'product_desc', 'design_desc', 'height', 'width', 'length', 'colour_code', 'wood_category', 'seasoning', 'amount', 'images']
const LABEL: Record<ItemField, string> = {
  product_code: 'Product Code', product_desc: 'Product Description', design_desc: 'Design Description', height: 'Height', width: 'Width', length: 'Length',
  colour_code: 'Colour', wood_category: 'Wood Category', seasoning: 'Wood Seasoning', amount: 'Amount', images: 'Product Images',
}

let seq = 0
const newItem = (): ItemDraft => ({
  uid: `i${++seq}`, product_code: '', product_name: '', category: '', product_desc: '', design_desc: '', height: '', width: '', length: '',
  colour_code: '', wood_category: '', seasoning: '', upholstery_needed: false, amount: '', images: [], uploading: 0,
})
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

/** Message for one item field. `required` is false when saving a draft: only what was typed is checked. */
function checkItem(it: ItemDraft, f: ItemField, required: boolean): string {
  if (f === 'images') {
    if (it.images.length > MAX_IMAGES) return 'Up to 10 images can be added per item.'
    return required && !it.images.length ? 'Please add at least one product image.' : ''
  }
  const v = it[f].trim()
  if (f === 'product_desc' || f === 'design_desc') return v.length > 1000 ? `${LABEL[f]} can be up to 1,000 characters.` : ''
  if (!v) return required ? `Please enter ${LABEL[f]}.` : ''
  if (f === 'height' || f === 'width' || f === 'length' || f === 'amount') {
    const n = Number(v)
    if (Number.isNaN(n) || n <= 0) return `${LABEL[f]} must be greater than 0.`
  }
  return ''
}

/** Label + control + message, without wrapping the control in a <label> (for groups of buttons and pickers). */
function Group({ label, required, error, hint, children, className }: { label: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
        {label}{required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs font-medium text-red-600">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </div>
  )
}

/** Searchable product code select. */
function ProductPicker({ products, value, fallbackName, invalid, onPick, onBlur }: {
  products: Master[]; value: string; fallbackName?: string; invalid?: boolean; onPick: (p: Master | null) => void; onBlur: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = products.find((p) => p.code === value)
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle ? products.filter((p) => `${p.code} ${p.name} ${p.category ?? ''}`.toLowerCase().includes(needle)) : products
    return list.slice(0, 60)
  }, [products, q])
  const display = value ? `${value}${selected?.name || fallbackName ? ` — ${selected?.name ?? fallbackName}` : ''}` : ''
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
      <Input role="combobox" aria-expanded={open} aria-label="Product Code" autoComplete="off" className="pl-9 pr-9" invalid={invalid}
        placeholder="Search code or product name" value={open ? q : display}
        onFocus={() => { setQ(''); setOpen(true) }}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Enter' && open) { e.preventDefault(); if (shown.length === 1) { onPick(shown[0]); setOpen(false); (e.target as HTMLInputElement).blur() } }
        }}
        onBlur={() => { setOpen(false); onBlur() }} />
      {value && !open && (
        <button type="button" aria-label="Clear product" onClick={() => onPick(null)} className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      )}
      {open && (
        <ul role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop">
          {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-500">No product code matches. Please select a code from the list.</li>}
          {shown.map((p) => (
            <li key={p.code} role="option" aria-selected={p.code === value}>
              {/* mouse down keeps the input focused until the choice is made */}
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(p); setOpen(false); (document.activeElement as HTMLElement | null)?.blur() }}
                className={cx('flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50', p.code === value && 'bg-brand-50')}>
                <span className="shrink-0 font-semibold text-brand-900">{p.code}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{p.name}</span>
                {p.category && <span className="shrink-0 text-xs text-slate-400">{p.category}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface OrderData {
  id: number; order_no?: string; status: string; state: string; editable?: boolean; return_reason?: string
  customer_id: number; customer: string; customer_code?: string; customer_phone?: string; customer_address?: string; promised_date?: string
  items: any[]
}

export default function OrderForm() {
  const { id } = useParams()
  const location = useLocation()
  const [nonce, setNonce] = useState(0)
  const lead: LeadRef | null = !id && nonce === 0 ? ((location.state as { lead?: LeadRef } | null)?.lead ?? null) : null
  // the key gives a clean form when moving between "new" and "edit", and after "New order"
  return <Form key={`${id ?? 'new'}-${nonce}`} orderId={id} lead={lead} onNew={() => setNonce((n) => n + 1)} />
}

function Form({ orderId, lead, onNew }: { orderId?: string; lead: LeadRef | null; onNew: () => void }) {
  const nav = useNavigate()
  const { refreshBadges } = useAuth()
  const { toast, confirm } = useUi()
  const meta = useLoad<any>(() => api.get('/meta'), [])
  const order = useLoad<OrderData | null>(() => (orderId ? api.get(`/orders/${orderId}`) : Promise.resolve(null)), [orderId])

  const [custMode, setCustMode] = useState<'existing' | 'new'>(lead ? 'new' : 'existing')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Customer[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [newCust, setNewCust] = useState({ name: lead?.customer_name ?? '', phone: lead?.customer_phone ?? '', address: '' })
  const [existing, setExisting] = useState<Customer | null>(null) // from a "customer_exists" answer
  const [useNew, setUseNew] = useState(false)
  const [promised, setPromised] = useState('')
  const [origPromised, setOrigPromised] = useState('')
  const [items, setItems] = useState<ItemDraft[]>(() => [newItem()])
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState<'draft' | 'place' | null>(null)
  const [placed, setPlaced] = useState<{ id: number; order_no?: string; message: string } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const masters = meta.data?.masters ?? {}
  const products: Master[] = masters.product ?? []
  const colours: Master[] = masters.colour ?? []
  const woods: Master[] = masters.wood ?? []
  const seasonings: Master[] = masters.seasoning?.length ? masters.seasoning : [{ code: 'S', name: 'Seasonal' }, { code: 'NS', name: 'Non-Seasonal' }]
  const unit = currentSettings().measurement_unit === 'in' || !currentSettings().measurement_unit ? 'inches' : currentSettings().measurement_unit

  // ---- edit mode: fill the form from the saved order (once)
  const o = order.data
  useEffect(() => {
    if (!o || loaded) return
    setLoaded(true)
    setCustMode('existing')
    setCustomer({ id: o.customer_id, code: o.customer_code, name: o.customer, phone: o.customer_phone, address: o.customer_address })
    const p = str(o.promised_date).slice(0, 10)
    setPromised(p)
    setOrigPromised(p)
    const list: ItemDraft[] = (o.items ?? []).map((it: any) => ({
      uid: `i${++seq}`, product_code: str(it.product_code), product_name: str(it.product_name), category: str(it.category),
      product_desc: str(it.product_desc), design_desc: str(it.design_desc), height: str(it.height), width: str(it.width), length: str(it.length),
      colour_code: str(it.colour_code), wood_category: str(it.wood_category), seasoning: str(it.seasoning),
      upholstery_needed: !!it.upholstery_needed, amount: str(it.amount),
      images: (it.images ?? []).map((i: any) => ({ file: i.file, name: i.name ?? i.file })), uploading: 0,
    }))
    setItems(list.length ? list : [newItem()])
  }, [o, loaded])

  // ---- customer search (debounced)
  useEffect(() => {
    if (custMode !== 'existing' || customer) return
    const q = search.trim()
    if (q.length < 2) { setResults(null); setSearching(false); return }
    let live = true
    setSearching(true)
    const t = setTimeout(() => {
      api.get<Customer[]>(`/customers?q=${encodeURIComponent(q)}`)
        .then((r) => { if (live) setResults(r) })
        .catch(() => { if (live) setResults([]) })
        .finally(() => { if (live) setSearching(false) })
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [search, custMode, customer])

  const setErr = (key: string, msg: string) => setErrors((e) => (e[key] === msg || (!msg && !e[key]) ? e : { ...e, [key]: msg }))
  const patch = (uid: string, p: Partial<ItemDraft>) => setItems((list) => list.map((it) => (it.uid === uid ? { ...it, ...p } : it)))
  const change = (uid: string, f: ItemField, value: string) => { patch(uid, { [f]: value } as Partial<ItemDraft>); setErr(`${uid}.${f}`, ''); setFormError('') }
  const blurItem = (it: ItemDraft, f: ItemField) => setErr(`${it.uid}.${f}`, checkItem(it, f, true))

  const checkPromised = (v: string) => (v && v < todayISO() && v !== origPromised ? 'Promised Delivery Date must be on or after the order date.' : '')
  const checkName = (v: string) => {
    const t = v.trim()
    return !t ? 'Please enter Customer Name.' : t.length < 2 || t.length > 100 ? 'Customer Name must be 2 to 100 characters.' : ''
  }
  const checkPhone = (v: string) => {
    if (!v.trim()) return ''
    const n = v.replace(/[^\d]/g, '').length
    return n < 7 || n > 15 ? 'Please enter a valid mobile number.' : ''
  }

  // ---- images: each accepted file is uploaded at once; a refused file never removes the others
  const addImages = async (uid: string, files: FileList | null) => {
    if (!files?.length) return
    const current = items.find((i) => i.uid === uid)
    if (!current) return
    const problems: string[] = []
    let room = MAX_IMAGES - current.images.length - current.uploading
    const accepted: File[] = []
    Array.from(files).forEach((f) => {
      if (!['image/jpeg', 'image/png'].includes(f.type) || f.size > MAX_IMAGE) { problems.push(`${f.name} is not accepted. Use JPG or PNG up to 5 MB.`); return }
      if (room <= 0) { if (!problems.includes('Up to 10 images can be added per item.')) problems.push('Up to 10 images can be added per item.'); return }
      room -= 1
      accepted.push(f)
    })
    setErr(`${uid}.images`, problems.join(' '))
    if (!accepted.length) return
    setItems((list) => list.map((it) => (it.uid === uid ? { ...it, uploading: it.uploading + accepted.length } : it)))
    await Promise.all(accepted.map(async (f) => {
      try {
        const res = await api.upload(f)
        setItems((list) => list.map((it) => (it.uid === uid ? { ...it, uploading: it.uploading - 1, images: [...it.images, { file: res.file, name: res.name || f.name }] } : it)))
      } catch (e) {
        problems.push(errText(e))
        setItems((list) => list.map((it) => (it.uid === uid ? { ...it, uploading: it.uploading - 1 } : it)))
        setErr(`${uid}.images`, problems.join(' '))
      }
    }))
  }
  const removeImage = (uid: string, file: string) => setItems((list) => list.map((it) => (it.uid === uid ? { ...it, images: it.images.filter((i) => i.file !== file) } : it)))

  const removeItem = (uid: string) => {
    setItems((list) => (list.length > 1 ? list.filter((it) => it.uid !== uid) : list))
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`${uid}.`))))
  }

  const scrollToError = () => setTimeout(() => {
    rootRef.current?.querySelector('[role="alert"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, 50)

  const validate = (place: boolean): boolean => {
    const errs: Errors = {}
    if (custMode === 'existing') {
      if (!customer) errs.customer = 'Please enter Customer.'
    } else {
      const n = checkName(newCust.name); if (n) errs.customer = n
      const p = checkPhone(newCust.phone); if (p) errs.customer_phone = p
    }
    const pd = checkPromised(promised); if (pd) errs.promised_date = pd
    items.forEach((it) => ITEM_FIELDS.forEach((f) => { const m = checkItem(it, f, place); if (m) errs[`${it.uid}.${f}`] = m }))
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const alwaysPlaced = o?.state === 'placed' // a placed order stays placed when edited
  const uploading = items.some((i) => i.uploading > 0)

  const send = async (place: boolean, opts: { confirmDuplicate?: boolean; forceNew?: boolean; customerOverride?: Customer } = {}) => {
    const cust = opts.customerOverride ?? (custMode === 'existing' ? customer : null)
    const body: Record<string, any> = {
      ...actingBody(),
      promised_date: promised || null, place,
      items: items.map((it) => ({
        product_code: it.product_code, product_desc: it.product_desc.trim(), design_desc: it.design_desc.trim(),
        height: it.height.trim() === '' ? null : Number(it.height), width: it.width.trim() === '' ? null : Number(it.width), length: it.length.trim() === '' ? null : Number(it.length),
        colour_code: it.colour_code, wood_category: it.wood_category, seasoning: it.seasoning, upholstery_needed: it.upholstery_needed,
        amount: it.amount.trim() === '' ? null : Number(it.amount),
        images: it.images.map((i) => i.file), image_names: Object.fromEntries(it.images.map((i) => [i.file, i.name])),
      })),
    }
    if (cust) body.customer_id = cust.id
    else {
      body.customer = { name: newCust.name.trim(), phone: newCust.phone.trim(), address: newCust.address.trim() }
      if (useNew || opts.forceNew) body.use_new_customer = true
    }
    if (lead?.id) body.lead_id = lead.id
    if (opts.confirmDuplicate) body.confirm_duplicate = true

    setSaving(place ? 'place' : 'draft')
    setFormError('')
    try {
      const res = orderId ? await api.put(`/orders/${orderId}`, body) : await api.post('/orders', body)
      if (place || alwaysPlaced) {
        refreshBadges()
        setPlaced({ id: res.id, order_no: res.order_no, message: alwaysPlaced ? `Order ${res.order_no ?? ''} updated. The Production Manager sees the corrected order.`.replace('  ', ' ') : res.message })
      } else {
        toast.success(res.message)
        refreshBadges()
        nav('/sales/orders')
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'customer_exists' && e.data?.customer) {
        setExisting(e.data.customer as Customer)
        setErr('customer_phone', e.message)
        scrollToError()
      } else if (e instanceof ApiError && e.status === 409 && e.code === 'duplicate') {
        const ok = await confirm({ title: 'Possible duplicate order', message: alwaysPlaced ? e.message.replace('Place this order anyway?', 'Save the changes anyway?') : e.message, confirmLabel: alwaysPlaced ? 'Save anyway' : 'Place order anyway', tone: 'warn' })
        if (ok) { await send(place, { ...opts, confirmDuplicate: true }); return }
      } else if (e instanceof ApiError && e.fields) {
        const mapped: Errors = {}
        Object.entries(e.fields).forEach(([k, msg]) => {
          const m = /^items\.(\d+)\.(.+)$/.exec(k)
          if (m && items[+m[1]]) mapped[`${items[+m[1]].uid}.${m[2]}`] = msg
          else mapped[k] = msg
        })
        setErrors(mapped)
        setFormError(mapped.items ?? e.message)
        scrollToError()
      } else {
        setFormError(errText(e))
        toast.error(errText(e))
      }
    } finally {
      setSaving(null)
    }
  }

  const submit = (place: boolean) => {
    if (saving) return
    if (uploading) { toast.warn('Please wait until the images have finished uploading.'); return }
    if (!validate(place)) { setFormError('Please correct the highlighted fields.'); scrollToError(); return }
    void send(place)
  }

  const useExisting = (c: Customer) => {
    setCustMode('existing'); setCustomer(c); setExisting(null); setUseNew(false)
    setErrors((e) => ({ ...e, customer: '', customer_phone: '' }))
    setFormError('')
  }

  // ---------------------------------------------------------------- render
  const editing = !!orderId
  const title = editing ? (o?.order_no ? `Edit order ${o.order_no}` : 'Edit draft order') : 'New Customer Order'
  const back = <Link to="/sales/orders"><Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>Order Records</Button></Link>

  if (meta.loading || (editing && order.loading && !o)) return <Spinner />
  if (meta.error || order.error) return <div><PageHeader title={title} actions={back} /><ErrorNote error={meta.error || order.error} /></div>
  if (editing && o && !o.editable) {
    return (
      <div>
        <PageHeader title={title} actions={back} />
        <Notice tone="warn">
          This order can no longer be edited{o.status === 'Cancelled' ? ' because it was cancelled' : ' because an item has been assigned to a site'}.{' '}
          <Link to={`/orders/${o.id}`} className="font-semibold underline">View order</Link>
        </Notice>
      </div>
    )
  }

  const total = items.reduce((t, it) => t + (Number(it.amount) > 0 ? Number(it.amount) : 0), 0)
  const busy = saving !== null

  return (
    <div ref={rootRef}>
      <PageHeader title={title}
        subtitle={editing ? 'Correct the order, then save it or place it again.' : 'Record the customer, the items and their images, then place the order.'}
        actions={<>{!editing && <ActingSalesAdminPicker />}{back}</>} />

      <div className="space-y-5">
        {o?.return_reason && <Notice tone="warn"><span className="font-semibold">Returned by the Production Manager:</span> {o.return_reason}</Notice>}
        {lead && <Notice>This order starts from a Won lead. The customer name and phone were filled in from the lead.</Notice>}

        {/* ---------------- customer ---------------- */}
        <Card title="Customer"
          actions={!customer || custMode === 'new' ? (
            <Tabs<'existing' | 'new'> value={custMode} className="!shadow-none"
              onChange={(v) => { setCustMode(v); setExisting(null); setErrors((e) => ({ ...e, customer: '', customer_phone: '' })) }}
              options={[{ value: 'existing', label: 'Existing customer' }, { value: 'new', label: 'New customer' }]} />
          ) : undefined}>
          {custMode === 'existing' ? (
            customer ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-brand-950">{customer.name}{customer.code && <span className="ml-2 text-xs font-semibold text-brand-700">{customer.code}</span>}</p>
                  {(customer.phone || customer.address) && <p className="mt-0.5 break-words text-sm text-slate-600">{[customer.phone, customer.address].filter(Boolean).join(' · ')}</p>}
                </div>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setCustomer(null); setSearch(''); setResults(null); setErr('customer', '') }}>Change customer</Button>
                {errors.customer && <span role="alert" className="w-full text-xs font-medium text-red-600">{errors.customer}</span>}
              </div>
            ) : (
              <Group label="Find customer" required error={errors.customer} hint="Search by phone, name or Customer ID.">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input aria-label="Find customer" className="pl-9" autoComplete="off" placeholder="Type at least 2 characters" value={search} invalid={!!errors.customer}
                    onChange={(e) => { setSearch(e.target.value); setErr('customer', '') }} />
                  {searching && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-brand-600" />}
                </div>
                {results && (
                  <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                    {results.length === 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3 text-sm text-slate-600">
                        <span>No customer matches “{search.trim()}”.</span>
                        <Button variant="secondary" size="sm" icon={<UserPlus className="h-3.5 w-3.5" />}
                          onClick={() => { const q = search.trim(); const isPhone = /^[+\d\s-]+$/.test(q); setNewCust((c) => ({ ...c, name: isPhone ? c.name : q, phone: isPhone ? q : c.phone })); setCustMode('new'); setErr('customer', '') }}>
                          Add as new customer
                        </Button>
                      </div>
                    ) : (
                      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
                        {results.map((c) => (
                          <li key={c.id}>
                            <button type="button" onClick={() => useExisting(c)} className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5 text-left text-sm hover:bg-brand-50">
                              <span className="font-semibold text-brand-950">{c.name}</span>
                              {c.code && <span className="text-xs font-semibold text-brand-700">{c.code}</span>}
                              {c.phone && <span className="text-slate-600">{c.phone}</span>}
                              {c.address && <span className="min-w-0 truncate text-xs text-slate-500">{c.address}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Group>
            )
          ) : (
            <div className="space-y-4">
              {existing && (
                <Notice tone="warn">
                  <p>Existing customer: <span className="font-semibold">{existing.name}</span>{[existing.code, existing.phone, existing.address].filter(Boolean).map((v) => ` · ${v}`).join('')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => useExisting(existing)}>Use this customer</Button>
                    <Button size="sm" variant="secondary" onClick={() => { setUseNew(true); setExisting(null); setErr('customer_phone', '') }}>Keep as a new customer</Button>
                  </div>
                </Notice>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Customer Name" required error={errors.customer}>
                  <Input value={newCust.name} maxLength={100} invalid={!!errors.customer}
                    onChange={(e) => { setNewCust((c) => ({ ...c, name: e.target.value })); setErr('customer', '') }}
                    onBlur={() => setErr('customer', checkName(newCust.name))} />
                </Field>
                <Field label="Phone" error={errors.customer_phone} hint="Optional">
                  <Input type="tel" inputMode="tel" value={newCust.phone} maxLength={20} invalid={!!errors.customer_phone}
                    onChange={(e) => { setNewCust((c) => ({ ...c, phone: e.target.value })); setErr('customer_phone', ''); setExisting(null); setUseNew(false) }}
                    onBlur={() => setErr('customer_phone', checkPhone(newCust.phone))} />
                </Field>
                <Field label="Address" hint="Optional" className="md:col-span-2">
                  <Textarea rows={2} value={newCust.address} maxLength={300} onChange={(e) => setNewCust((c) => ({ ...c, address: e.target.value }))} />
                </Field>
              </div>
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Promised Delivery Date" error={errors.promised_date} hint="Optional">
              <Input type="date" min={todayISO()} value={promised} invalid={!!errors.promised_date}
                onChange={(e) => { setPromised(e.target.value); setErr('promised_date', '') }}
                onBlur={() => setErr('promised_date', checkPromised(promised))} />
            </Field>
          </div>
        </Card>

        {/* ---------------- items ---------------- */}
        {items.map((it, idx) => {
          const E = (f: ItemField) => errors[`${it.uid}.${f}`]
          const product = products.find((p) => p.code === it.product_code)
          const name = product?.name ?? it.product_name
          const category = product?.category ?? it.category
          const colourKnown = !it.colour_code || colours.some((c) => c.code === it.colour_code)
          const woodKnown = !it.wood_category || woods.some((w) => w.name === it.wood_category)
          const seasKnown = !it.seasoning || seasonings.some((s) => s.name === it.seasoning)
          const full = it.images.length + it.uploading >= MAX_IMAGES
          return (
            <Card key={it.uid} title={`Item ${idx + 1}${name ? ` · ${name}` : ''}`}
              actions={items.length > 1 ? <Button variant="ghost" size="sm" className="!text-red-600 hover:!bg-red-50" disabled={busy} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeItem(it.uid)}>Remove item</Button> : undefined}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Group label="Product Code" required error={E('product_code')}>
                  <ProductPicker products={products} value={it.product_code} fallbackName={it.product_name} invalid={!!E('product_code')}
                    onPick={(p) => { patch(it.uid, { product_code: p?.code ?? '', product_name: p?.name ?? '', category: p?.category ?? '' }); setErr(`${it.uid}.product_code`, ''); setFormError('') }}
                    onBlur={() => {
                      // checked after a pick from the list has been applied
                      setTimeout(() => { const cur = itemsRef.current.find((x) => x.uid === it.uid); if (cur) setErr(`${it.uid}.product_code`, checkItem(cur, 'product_code', true)) }, 0)
                    }} />
                </Group>
                <Field label="Product Name" hint="Filled in from the product code">
                  <Input value={name} readOnly disabled placeholder="—" />
                </Field>
                <Field label="Category" hint="Filled in from the product code">
                  <Input value={category} readOnly disabled placeholder="—" />
                </Field>

                <Field label="Product Description" error={E('product_desc')} className="md:col-span-2 xl:col-span-3">
                  <Textarea rows={2} value={it.product_desc} maxLength={1000} invalid={!!E('product_desc')}
                    onChange={(e) => change(it.uid, 'product_desc', e.target.value)} onBlur={() => blurItem(it, 'product_desc')} />
                </Field>
                <Field label="Design Description" error={E('design_desc')} hint={`Optional · ${it.design_desc.length} / 1,000`} className="md:col-span-2 xl:col-span-3">
                  <Textarea rows={2} value={it.design_desc} maxLength={1000} invalid={!!E('design_desc')}
                    onChange={(e) => change(it.uid, 'design_desc', e.target.value)} onBlur={() => blurItem(it, 'design_desc')} />
                </Field>

                {(['height', 'width', 'length'] as const).map((f) => (
                  <Field key={f} label={`${LABEL[f]} (${unit})`} required error={E(f)}>
                    <Input type="number" inputMode="decimal" min={0} step="any" value={it[f]} invalid={!!E(f)}
                      onChange={(e) => change(it.uid, f, e.target.value)} onBlur={() => blurItem(it, f)} />
                  </Field>
                ))}

                <Field label="Colour" required error={E('colour_code')}>
                  <Select value={it.colour_code} invalid={!!E('colour_code')} onChange={(e) => change(it.uid, 'colour_code', e.target.value)} onBlur={() => blurItem(it, 'colour_code')}>
                    <option value="">Select colour</option>
                    {!colourKnown && <option value={it.colour_code}>{it.colour_code}</option>}
                    {colours.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                  </Select>
                </Field>
                <Field label="Wood Category" required error={E('wood_category')}>
                  <Select value={it.wood_category} invalid={!!E('wood_category')} onChange={(e) => change(it.uid, 'wood_category', e.target.value)} onBlur={() => blurItem(it, 'wood_category')}>
                    <option value="">Select wood category</option>
                    {!woodKnown && <option value={it.wood_category}>{it.wood_category}</option>}
                    {woods.map((w) => <option key={w.code ?? w.name} value={w.name}>{w.name}</option>)}
                  </Select>
                </Field>
                <Field label="Wood Seasoning" required error={E('seasoning')}>
                  <Select value={it.seasoning} invalid={!!E('seasoning')} onChange={(e) => change(it.uid, 'seasoning', e.target.value)} onBlur={() => blurItem(it, 'seasoning')}>
                    <option value="">Select wood seasoning</option>
                    {!seasKnown && <option value={it.seasoning}>{it.seasoning}</option>}
                    {seasonings.map((s) => <option key={s.code ?? s.name} value={s.name}>{s.name}</option>)}
                  </Select>
                </Field>

                <Group label="Upholstery needed" required>
                  <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1" role="radiogroup" aria-label="Upholstery needed">
                    {[true, false].map((v) => (
                      <button key={String(v)} type="button" role="radio" aria-checked={it.upholstery_needed === v} onClick={() => patch(it.uid, { upholstery_needed: v })}
                        className={cx('h-8 min-w-16 rounded-md px-4 text-[13px] font-semibold transition', it.upholstery_needed === v ? 'bg-brand-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100')}>
                        {v ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </Group>
                <Field label="Amount" required error={E('amount')} hint={Number(it.amount) > 0 ? money(Number(it.amount)) : undefined}>
                  <Input type="number" inputMode="decimal" min={0} step="any" value={it.amount} invalid={!!E('amount')}
                    onChange={(e) => change(it.uid, 'amount', e.target.value)} onBlur={() => blurItem(it, 'amount')} />
                </Field>

                <Group label="Product Images" required error={E('images')} className="md:col-span-2 xl:col-span-3"
                  hint={`JPG or PNG, up to 5 MB each, up to ${MAX_IMAGES} per item. ${it.images.length} added.`}>
                  <div className={cx('flex flex-wrap gap-2.5 rounded-lg border border-dashed p-3', E('images') ? 'border-red-300 bg-red-50/40' : 'border-slate-300 bg-slate-50/60')}>
                    {it.images.map((img) => (
                      <div key={img.file} className="group relative">
                        <AuthImage file={img.file} alt={img.name} className="h-20 w-24 rounded-lg border border-slate-200" />
                        <button type="button" aria-label={`Remove ${img.name}`} title={`Remove ${img.name}`} onClick={() => removeImage(it.uid, img.file)}
                          className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow hover:bg-red-700">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {Array.from({ length: it.uploading }, (_, i) => (
                      <div key={`up${i}`} className="flex h-20 w-24 items-center justify-center rounded-lg border border-slate-200 bg-white text-brand-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ))}
                    {!full && (
                      <label className="flex h-20 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-brand-800 hover:border-brand-400 hover:bg-brand-50">
                        <ImagePlus className="h-5 w-5" /> Add images
                        <input type="file" accept="image/jpeg,image/png" multiple className="sr-only"
                          onChange={(e) => { const files = e.target.files; void addImages(it.uid, files).finally(() => { e.target.value = '' }) }} />
                      </label>
                    )}
                  </div>
                </Group>
              </div>
            </Card>
          )
        })}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={busy} onClick={() => setItems((list) => [...list, newItem()])}>Add another item</Button>
          {total > 0 && <p className="text-sm text-slate-600">{items.length} {items.length === 1 ? 'item' : 'items'} · Order amount <span className="font-display text-lg font-bold tabular text-brand-950">{money(total)}</span></p>}
        </div>

        <ErrorNote error={formError} />

        <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:shadow-card lg:bottom-0">
          <span className="mr-auto hidden text-xs text-slate-500 sm:inline"><span className="text-red-600">*</span> Required to place the order</span>
          {!alwaysPlaced && <Button variant="secondary" loading={saving === 'draft'} disabled={busy} onClick={() => submit(false)}>Save draft</Button>}
          <Button icon={<Send className="h-4 w-4" />} loading={saving === 'place'} disabled={busy} onClick={() => submit(true)}>{alwaysPlaced ? 'Save changes' : 'Place Order'}</Button>
        </div>
      </div>

      <Modal open={!!placed} onClose={() => nav('/sales/orders')} title={alwaysPlaced ? 'Order updated' : 'Order placed'} size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => { if (editing) nav('/sales/orders/new'); else { nav('/sales/orders/new', { replace: true, state: null }); onNew() } }}>New order</Button>
          <Button onClick={() => placed && nav(`/orders/${placed.id}`)}>View order</Button>
        </>}>
        {placed && (
          <div className="flex flex-col items-center gap-3 py-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-8 w-8" /></div>
            <p className="text-sm font-medium text-slate-800">{placed.message}</p>
            {placed.order_no && <p className="font-display text-xl font-bold tracking-tight text-brand-950">{placed.order_no}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
