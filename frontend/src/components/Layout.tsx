// App shell: top bar with the user's name and role, a left menu (bottom menu on phones) and the work area (BRD 10.1).
import { LogOut, Menu, MoreHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { navFor, type NavItem } from '../lib/nav'
import { Logo } from './Logo'
import { cx } from './ui'

function NavRow({ item, badge, onNavigate }: { item: NavItem; badge?: number; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  // "/sales/orders" must not light up while "/sales/orders/new" is open
  const exactOnly = item.to === '/sales/orders' && pathname.startsWith('/sales/orders/new')
  return (
    <NavLink to={item.to} onClick={onNavigate} end={item.to === '/warehouse'}
      className={({ isActive }) => cx('group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition',
        isActive && !exactOnly ? 'bg-white/12 text-white shadow-[inset_3px_0_0_0_var(--color-gold-400)]' : 'text-brand-200 hover:bg-white/6 hover:text-white')}>
      <span className="shrink-0 opacity-90">{item.icon}</span>
      <span className="flex-1 truncate">{item.label}</span>
      {!!badge && <span className="rounded-full bg-gold-400 px-2 py-0.5 text-[11px] font-bold leading-none text-brand-950" title={`${badge} new`}>{badge}</span>}
    </NavLink>
  )
}

function Sidebar({ items, badges, onNavigate }: { items: NavItem[]; badges: Record<string, number>; onNavigate?: () => void }) {
  const groups = useMemo(() => {
    const out: { name: string; items: NavItem[] }[] = []
    items.forEach((i) => {
      const name = i.group ?? ''
      const g = out.find((x) => x.name === name)
      if (g) g.items.push(i); else out.push({ name, items: [i] })
    })
    return out
  }, [items])
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main menu">
      {groups.map((g) => (
        <div key={g.name}>
          {g.name && <p className="mb-1.5 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-brand-400">{g.name}</p>}
          <div className="space-y-0.5">
            {g.items.map((i) => <NavRow key={i.to} item={i} badge={i.badge ? badges[i.badge] : undefined} onNavigate={onNavigate} />)}
          </div>
        </div>
      ))}
    </nav>
  )
}

export default function Layout() {
  const { user, settings, badges, logout } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { setDrawer(false); window.scrollTo(0, 0) }, [pathname])
  if (!user) return null
  const items = navFor(user)
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const bottom = items.slice(0, 4)

  return (
    <div className="min-h-screen lg:pl-64">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-900 lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-5"><Logo light /></div>
        <Sidebar items={items} badges={badges} />
        <div className="border-t border-white/10 px-5 py-3 text-[11px] leading-relaxed text-brand-300">
          <p className="truncate font-semibold text-brand-100">{settings?.organisation}</p>
          <p>Athena Business Automation</p>
        </div>
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-brand-950/60" onClick={() => setDrawer(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-900 shadow-pop">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
              <Logo light />
              <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="rounded-lg p-1.5 text-brand-200 hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            <Sidebar items={items} badges={badges} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <header className="app-topbar sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
        <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="rounded-lg p-2 text-brand-800 hover:bg-slate-100 lg:hidden"><Menu className="h-5 w-5" /></button>
        <div className="lg:hidden"><Logo compact /></div>
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-sm font-semibold text-brand-950">{settings?.organisation}</p>
          <p className="text-xs text-slate-500">{user.branch ? `${user.branch} · ` : ''}{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right leading-tight">
            <p className="max-w-[40vw] truncate text-sm font-semibold text-brand-950">{user.name}</p>
            <p className="text-xs font-medium text-gold-600">{user.role}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-800 text-sm font-bold text-white ring-2 ring-gold-300" aria-hidden>{initials}</div>
          <button type="button" onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"><LogOut className="h-[18px] w-[18px]" /></button>
        </div>
      </header>

      <main className="app-main mx-auto w-full max-w-[1500px] px-4 pb-28 pt-6 lg:px-8 lg:pb-12">
        <div key={pathname} className="animate-in"><Outlet /></div>
      </main>

      {/* phone bottom menu */}
      <nav className="app-bottomnav fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Quick menu">
        {bottom.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/warehouse'} className={({ isActive }) => cx('relative flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[10.5px] font-semibold', isActive ? 'text-brand-800' : 'text-slate-500')}>
            {i.icon}
            <span className="max-w-full truncate">{i.label.replace('Requisition ', '').replace('Production ', '')}</span>
            {!!(i.badge && badges[i.badge]) && <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-gold-500" />}
          </NavLink>
        ))}
        {items.length > 4 && (
          <button type="button" onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[10.5px] font-semibold text-slate-500">
            <MoreHorizontal className="h-[18px] w-[18px]" /> More
          </button>
        )}
      </nav>
    </div>
  )
}
