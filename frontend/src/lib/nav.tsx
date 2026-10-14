// Menus are built from the user's role (BRD Figure 14). Screen codes are noted for traceability.
import {
  Activity, BarChart3, Boxes, ClipboardCheck, ClipboardList, Coins, Database, FilePlus2, FileText, Gauge, Hammer,
  LayoutDashboard, LayoutGrid, ListChecks, NotebookPen, PackageCheck, ScrollText, Settings, ShieldCheck, Target,
  TreePine, TrendingUp, Truck, UserCog, Users, Warehouse,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { User } from './auth'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  /** key in the /badges response that shows a new-work count */
  badge?: string
  group?: string
}

const I = 'h-[18px] w-[18px]'

export function navFor(user: User): NavItem[] {
  const cost: NavItem = { to: '/cost', label: 'Production Cost', icon: <Coins className={I} />, group: 'Reports' }
  const reports: NavItem = { to: '/reports', label: 'Production Reports', icon: <FileText className={I} />, group: 'Reports' }
  let items: NavItem[] = []
  switch (user.role) {
    case 'Sales Admin':
      items = [
        { to: '/sales/dashboard', label: 'Dashboard', icon: <LayoutDashboard className={I} />, group: 'Orders' },          // S1
        { to: '/sales/orders/new', label: 'New Order', icon: <FilePlus2 className={I} />, group: 'Orders' },               // S2
        { to: '/sales/orders', label: 'Order Records', icon: <ClipboardList className={I} />, badge: 'returned_orders', group: 'Orders' }, // S3, S4
        { to: '/sales/record', label: 'Sales Record', icon: <NotebookPen className={I} />, group: 'Sales' },              // S5
        { to: '/sales/leads', label: 'Leads', icon: <TrendingUp className={I} />, group: 'Sales' },                        // S6
        reports,
      ]
      break
    case 'Production Manager':
      items = [
        { to: '/pm/orders', label: 'Orders', icon: <ClipboardList className={I} />, badge: 'pending_orders', group: 'Planning' }, // P1
        { to: '/pm/distribution', label: 'Work Distribution', icon: <LayoutGrid className={I} />, group: 'Planning' },    // P2
        { to: '/pm/site-board', label: 'Site Board', icon: <Boxes className={I} />, group: 'Planning' },                  // P3
        { to: '/monitor', label: 'Live Production Monitor', icon: <Activity className={I} />, group: 'Production' },
        { to: '/qc', label: 'QC Reports', icon: <ClipboardCheck className={I} />, badge: 'signoff', group: 'Production' },
        { to: '/pm/apms', label: 'Manage APMs', icon: <UserCog className={I} />, group: 'Production' },                    // P4
        { to: '/dashboard', label: 'Management Dashboard', icon: <Gauge className={I} />, group: 'Reports' },
        cost,                                                                                                              // P5
        reports,
      ]
      break
    case 'Assistant Production Manager':
      items = [
        { to: '/apm/work', label: 'My Work List', icon: <ListChecks className={I} />, badge: 'new_items', group: 'Production' }, // A1, A4
        { to: '/apm/store-requisitions', label: 'Store Requisitions', icon: <PackageCheck className={I} />, badge: 'returned_store', group: 'Requisitions' }, // A2
        { to: '/apm/wood-requisitions', label: 'Wood Requisitions', icon: <TreePine className={I} />, badge: 'returned_wood', group: 'Requisitions' },       // A3
        { to: '/qc', label: 'QC Reports', icon: <ClipboardCheck className={I} />, group: 'Production' },                   // A5
        reports,
      ]
      break
    case 'Store Operator':
      items = [{ to: '/store/inbox', label: 'Store Inbox', icon: <PackageCheck className={I} />, badge: 'store_inbox' }] // T1
      break
    case 'Saw-Mill Supervisor':
      items = [{ to: '/sawmill/inbox', label: 'Wood Inbox', icon: <Hammer className={I} />, badge: 'wood_inbox' }]        // W1
      break
    case 'Warehouse / Delivery':
      items = [
        { to: '/warehouse', label: 'Warehouse List', icon: <Warehouse className={I} />, badge: 'warehouse' },              // G1
        { to: '/warehouse/deliveries', label: 'Delivery Records', icon: <Truck className={I} /> },                         // G2
      ]
      break
    case 'Super Admin':
      // full access: every module of every role
      items = [
        { to: '/monitor', label: 'Live Production Monitor', icon: <Activity className={I} />, group: 'Operations' },       // X1
        { to: '/dashboard', label: 'Management Dashboard', icon: <Gauge className={I} />, group: 'Operations' },           // X2
        { to: '/orders', label: 'Order Records', icon: <ClipboardList className={I} />, badge: 'returned_orders', group: 'Orders' },
        { to: '/sales/orders/new', label: 'New Order', icon: <FilePlus2 className={I} />, group: 'Orders' },
        { to: '/pm/orders', label: 'Pending Orders', icon: <ClipboardList className={I} />, badge: 'pending_orders', group: 'Orders' },
        { to: '/pm/distribution', label: 'Work Distribution', icon: <LayoutGrid className={I} />, group: 'Orders' },
        { to: '/apm/work', label: 'Production Work List', icon: <ListChecks className={I} />, badge: 'new_items', group: 'Production' },
        { to: '/pm/site-board', label: 'Site Board', icon: <Boxes className={I} />, group: 'Production' },
        { to: '/qc', label: 'QC Reports', icon: <ClipboardCheck className={I} />, badge: 'signoff', group: 'Production' },
        { to: '/pm/apms', label: 'Manage APMs', icon: <UserCog className={I} />, group: 'Production' },
        { to: '/apm/store-requisitions', label: 'Store Requisitions', icon: <PackageCheck className={I} />, badge: 'returned_store', group: 'Store & Saw Mill' },
        { to: '/store/inbox', label: 'Store Inbox', icon: <PackageCheck className={I} />, badge: 'store_inbox', group: 'Store & Saw Mill' },
        { to: '/apm/wood-requisitions', label: 'Wood Requisitions', icon: <TreePine className={I} />, badge: 'returned_wood', group: 'Store & Saw Mill' },
        { to: '/sawmill/inbox', label: 'Wood Inbox', icon: <Hammer className={I} />, badge: 'wood_inbox', group: 'Store & Saw Mill' },
        { to: '/warehouse', label: 'Warehouse List', icon: <Warehouse className={I} />, badge: 'warehouse', group: 'Warehouse' },
        { to: '/warehouse/deliveries', label: 'Delivery Records', icon: <Truck className={I} />, group: 'Warehouse' },
        { to: '/sales-dashboard', label: 'Sales Dashboard', icon: <BarChart3 className={I} />, group: 'Sales' },           // X6
        { to: '/sales/dashboard', label: 'Order Dashboard', icon: <LayoutDashboard className={I} />, group: 'Sales' },
        { to: '/sales/record', label: 'Sales Records', icon: <NotebookPen className={I} />, group: 'Sales' },
        { to: '/sales/leads', label: 'Leads', icon: <TrendingUp className={I} />, group: 'Sales' },
        { to: '/admin/targets', label: 'Sales Targets', icon: <Target className={I} />, group: 'Sales' },                  // X8
        { to: '/reports', label: 'Production Reports', icon: <FileText className={I} />, group: 'Reports' },               // X7
        { ...cost, group: 'Reports' },
        { to: '/admin/users', label: 'Users & Accounts', icon: <Users className={I} />, group: 'Administration' },         // X3
        { to: '/admin/masters', label: 'Master Data', icon: <Database className={I} />, group: 'Administration' },         // X4
        { to: '/admin/audit', label: 'Audit Log', icon: <ScrollText className={I} />, group: 'Administration' },           // X5
        { to: '/admin/settings', label: 'Settings', icon: <Settings className={I} />, group: 'Administration' },
      ]
      break
  }
  // cost entry is a permission, not a role: granted users of other roles get the Production Cost screen (DEC-17)
  if (user.cost_permission && !items.some((i) => i.to === '/cost')) items.push({ ...cost, icon: <ShieldCheck className={I} /> })
  return items
}
