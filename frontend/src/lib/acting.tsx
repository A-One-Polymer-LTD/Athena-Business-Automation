// The Super Admin can create sales records (orders, sales entries, leads) on behalf of a chosen Sales Admin.
import { UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Select } from '../components/ui'
import { api } from './api'
import { useAuth } from './auth'

const KEY = 'athena.actingSalesAdmin'

/** Body fields to send with a sales record: the chosen Sales Admin when the Super Admin is signed in. */
export function actingBody(): { sales_admin_id?: number } {
  try {
    const v = Number(sessionStorage.getItem(KEY) || 0)
    return v ? { sales_admin_id: v } : {}
  } catch {
    return {}
  }
}

/** Picker shown to the Super Admin on the New Order, Sales Record and Leads screens. */
export function ActingSalesAdminPicker({ onChange }: { onChange?: (id: number) => void }) {
  const { user } = useAuth()
  const [list, setList] = useState<{ id: number; name: string; branch?: string; active: boolean; role: string }[]>([])
  const [value, setValue] = useState<number>(() => Number(actingBody().sales_admin_id || 0))
  useEffect(() => {
    if (user?.role !== 'Super Admin') return
    api.get('/users').then((rows: any[]) => {
      const admins = rows.filter((u) => u.role === 'Sales Admin' && u.active)
      setList(admins)
      if (!value && admins[0]) choose(admins[0].id)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role])
  if (user?.role !== 'Super Admin') return null
  function choose(id: number) {
    setValue(id)
    try { sessionStorage.setItem(KEY, String(id)) } catch { /* private mode */ }
    onChange?.(id)
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5">
      <UserRound className="h-4 w-4 shrink-0 text-brand-800" />
      <span className="whitespace-nowrap text-[13px] font-semibold text-brand-900">Recording for</span>
      <div className="w-56">
        <Select aria-label="Sales Admin" value={value || ''} onChange={(e) => choose(Number(e.target.value))}>
          {list.map((u) => <option key={u.id} value={u.id}>{u.name}{u.branch ? ` · ${u.branch}` : ''}</option>)}
        </Select>
      </div>
    </div>
  )
}
