import { Activity, ClipboardCheck, Eye, EyeOff, LineChart, Lock, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { Button, ErrorNote, Field, Input, Notice, errText } from '../components/ui'
import { homeFor, useAuth } from '../lib/auth'

const DEMO: { id: string; role: string; name: string }[] = [
  { id: 'superadmin', role: 'Super Admin', name: 'Anwar Hossain' },
  { id: 'sales1', role: 'Sales Admin · Branch North', name: 'Lamia Brown' },
  { id: 'sales2', role: 'Sales Admin · Branch South', name: 'Rashed Silva' },
  { id: 'pm', role: 'Production Manager', name: 'Mizanur Rahman' },
  { id: 'apm01', role: 'APM 01 · PS-01 to PS-03, CS-01', name: 'Shahidul Islam' },
  { id: 'apm02', role: 'APM 02 · PS-04 to PS-06', name: 'Habibur Rahman' },
  { id: 'store', role: 'Store Operator', name: 'Delwar Hossain' },
  { id: 'sawmill', role: 'Saw-Mill Supervisor', name: 'Abdul Jabbar' },
  { id: 'warehouse', role: 'Warehouse / Delivery', name: 'Monir Uddin' },
]
const DEMO_PASSWORD = 'Athena@123'

export default function Login() {
  const { user, login, notice } = useAuth()
  const nav = useNavigate()
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  if (user) return <Navigate to={homeFor(user.role)} replace />

  const signIn = async (id: string, pw: string) => {
    setError('')
    setBusy(id || 'form')
    try {
      const u = await login(id.trim(), pw)
      nav(homeFor(u.role), { replace: true })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy('')
    }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); signIn(loginId, password) }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-700/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-gold-500/15 blur-3xl" />
        <Logo light />
        <div className="relative max-w-lg">
          <h1 className="font-display text-[40px] font-extrabold leading-[1.1] tracking-tight">
            One system for sales, production, quality and <span className="text-gold-400">fulfilment</span>.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-brand-200">
            Athena OS gives every customer order a single digital record that each team updates — from the showroom, across every production site, to the customer's door.
          </p>
          <ul className="mt-9 space-y-4 text-sm text-brand-100">
            {[
              [<Activity key="a" className="h-5 w-5" />, 'Live stage of every item across all production sites'],
              [<ClipboardCheck key="b" className="h-5 w-5" />, 'Unified QC report with rework history and digital sign-off'],
              [<LineChart key="c" className="h-5 w-5" />, 'Production cost, Production Reports and sales performance in one place'],
              [<ShieldCheck key="d" className="h-5 w-5" />, 'Role-based access with a complete audit trail'],
            ].map(([icon, text], i) => (
              <li key={i} className="flex items-center gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gold-300">{icon}</span>{text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-400">© {new Date().getFullYear()} Athena Business Automation</p>
      </div>

      {/* sign-in panel */}
      <div className="flex flex-col items-center justify-center bg-surface px-5 py-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="text-2xl font-bold tracking-tight text-brand-950">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your user ID and password to open your workspace.</p>

          {notice && <Notice tone="warn" className="mt-5">{notice}</Notice>}
          <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-card" noValidate>
            <Field label="User ID" required>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" autoFocus autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="e.g. sales1" />
              </div>
            </Field>
            <Field label="Password" required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9 pr-10" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:text-slate-700">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" size="lg" className="w-full" loading={busy === 'form' || (!!busy && busy === loginId)}>Sign in</Button>
          </form>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[13px] font-bold text-brand-950">Demo accounts</p>
              <p className="text-xs text-slate-500">Password for all: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-brand-800">{DEMO_PASSWORD}</code></p>
            </div>
            <p className="mt-1 text-xs text-slate-500">Select a role to sign in and review its screens.</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEMO.map((d) => (
                <button key={d.id} type="button" disabled={!!busy} onClick={() => signIn(d.id, DEMO_PASSWORD)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-brand-400 hover:bg-brand-50 disabled:opacity-60">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-brand-950">{d.name}</span>
                    <code className="shrink-0 text-[11px] font-semibold text-gold-600">{d.id}</code>
                  </span>
                  <span className="block truncate text-[11.5px] text-slate-500">{d.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
