import { ShieldAlert } from 'lucide-react'
import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Button, Empty, Spinner } from './components/ui'
import { api } from './lib/api'
import { homeFor, useAuth, type Role } from './lib/auth'
import Login from './pages/Login'

/** Lazy screen. After a new deployment the old screen files are gone, so a tab that is still open on the
 *  previous version cannot load them: reload once to pick up the new version instead of showing nothing. */
function page(load: () => Promise<{ default: ComponentType<any> }>) {
  return lazy(() => load().then((m) => { store(null); return m }).catch((e) => {
    if (!store()) {
      store('1')
      window.location.reload()
      return new Promise<never>(() => {})
    }
    throw e
  }))
}
/** sessionStorage can be unavailable (private mode); then the reload is simply not attempted twice. */
function store(v?: string | null): string | null {
  try {
    if (v === undefined) return sessionStorage.getItem(RELOADED)
    if (v === null) sessionStorage.removeItem(RELOADED)
    else sessionStorage.setItem(RELOADED, v)
  } catch { return '1' }
  return null
}
const RELOADED = 'athena.reloadedForUpdate'

// Sales Admin
const SalesDashboard = page(() => import('./pages/sales/SalesDashboard'))       // S1
const OrderForm = page(() => import('./pages/sales/OrderForm'))                 // S2
const OrderRecords = page(() => import('./pages/sales/OrderRecords'))           // S3
const OrderDetail = page(() => import('./pages/sales/OrderDetail'))             // S4
const SalesRecord = page(() => import('./pages/sales/SalesRecord'))             // S5
const Leads = page(() => import('./pages/sales/Leads'))                         // S6
// Production Manager
const PmOrders = page(() => import('./pages/pm/PmOrders'))                      // P1
const WorkDistribution = page(() => import('./pages/pm/WorkDistribution'))      // P2
const SiteBoard = page(() => import('./pages/pm/SiteBoard'))                    // P3
const ManageApms = page(() => import('./pages/pm/ManageApms'))                  // P4
// APM
const WorkList = page(() => import('./pages/apm/WorkList'))                     // A1
const StoreRequisitions = page(() => import('./pages/apm/StoreRequisitions'))   // A2
const WoodRequisitions = page(() => import('./pages/apm/WoodRequisitions'))     // A3
const ItemDetail = page(() => import('./pages/apm/ItemDetail'))                 // A4 + A5
const QcReports = page(() => import('./pages/apm/QcReports'))
const ProductionInput = page(() => import('./pages/apm/ProductionInput')) // A4 queue
const QcRequests = page(() => import('./pages/apm/QcRequests'))           // A5 QC requests
// Store, saw mill, warehouse
const StoreInbox = page(() => import('./pages/ops/StoreInbox'))                 // T1
const WoodInbox = page(() => import('./pages/ops/WoodInbox'))                   // W1
const WarehouseList = page(() => import('./pages/ops/WarehouseList'))           // G1
const DeliveryRecords = page(() => import('./pages/ops/DeliveryRecords'))       // G2
// Super Admin
const LiveMonitor = page(() => import('./pages/admin/LiveMonitor'))             // X1
const ManagementDashboard = page(() => import('./pages/admin/ManagementDashboard')) // X2
const Users = page(() => import('./pages/admin/Users'))                         // X3
const MasterData = page(() => import('./pages/admin/MasterData'))               // X4
const AuditLog = page(() => import('./pages/admin/AuditLog'))                   // X5
const Settings = page(() => import('./pages/admin/Settings'))
const SalesPerformance = page(() => import('./pages/insight/SalesPerformance')) // X6
const SalesTargets = page(() => import('./pages/insight/SalesTargets'))         // X8
const ProductionReports = page(() => import('./pages/insight/ProductionReports')) // X7 list
const ProductionReportView = page(() => import('./pages/insight/ProductionReportView')) // X7 report
const ProductionCost = page(() => import('./pages/insight/ProductionCost'))     // P5 list
const CostSheet = page(() => import('./pages/insight/CostSheet'))               // P5 sheet

const SUPER: Role = 'Super Admin', SALES: Role = 'Sales Admin', PM: Role = 'Production Manager', APM: Role = 'Assistant Production Manager'
const STORE: Role = 'Store Operator', SAW: Role = 'Saw-Mill Supervisor', WH: Role = 'Warehouse / Delivery'

export function NoAccess({ message = 'You do not have access to this screen.' }: { message?: string }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  // refused attempts are written to the audit log
  useEffect(() => { api.post('/auth/denied', { path: pathname }).catch(() => {}) }, [pathname])
  return (
    <Empty icon={<ShieldAlert className="h-6 w-6" />} title={message} hint="Your role does not include this screen. The server refuses these requests as well."
      action={user && <Link to={homeFor(user.role)}><Button variant="secondary">Back to my home screen</Button></Link>} />
  )
}

/** Screens are shown only to permitted roles; the API enforces the same rule on every request. */
function Guard({ roles, cost, message, children }: { roles?: Role[]; cost?: boolean; message?: string; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  // the Super Admin has full access to every screen
  const ok = user.role === 'Super Admin' || (roles?.includes(user.role) ?? false) || (cost === true && user.can_view_cost)
  return ok ? <>{children}</> : <NoAccess message={message} />
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner label="Opening Athena OS…" /></div>
  const g = (roles: Role[], el: ReactNode, opts: { cost?: boolean; message?: string } = {}) => <Guard roles={roles} {...opts}>{el}</Guard>
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
          <Route index element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />

          <Route path="/sales/dashboard" element={g([SALES], <SalesDashboard />)} />
          <Route path="/sales/orders/new" element={g([SALES], <OrderForm />)} />
          <Route path="/sales/orders/:id/edit" element={g([SALES], <OrderForm />)} />
          <Route path="/sales/orders" element={g([SALES], <OrderRecords />)} />
          <Route path="/orders" element={g([SUPER, PM], <OrderRecords />)} />
          <Route path="/orders/:id" element={g([SALES, SUPER, PM], <OrderDetail />)} />
          <Route path="/sales/record" element={g([SALES], <SalesRecord />)} />
          <Route path="/sales/leads" element={g([SALES], <Leads />)} />

          <Route path="/pm/orders" element={g([PM], <PmOrders />)} />
          <Route path="/pm/distribution" element={g([PM], <WorkDistribution />)} />
          <Route path="/pm/site-board" element={g([PM, SUPER], <SiteBoard />)} />
          <Route path="/pm/apms" element={g([PM, SUPER], <ManageApms />)} />

          <Route path="/apm/work" element={g([APM], <WorkList />)} />
          <Route path="/apm/store-requisitions" element={g([APM], <StoreRequisitions />)} />
          <Route path="/apm/wood-requisitions" element={g([APM], <WoodRequisitions />)} />
          <Route path="/items/:id" element={g([APM, PM, SUPER, SALES, WH], <ItemDetail />, { cost: true })} />
          <Route path="/qc" element={g([APM, PM, SUPER], <QcReports />)} />
          <Route path="/production-input" element={g([APM, PM], <ProductionInput />)} />
          <Route path="/qc-requests" element={g([APM, PM], <QcRequests />)} />
          <Route path="/qc-input" element={<Navigate to="/qc-requests" replace />} />

          <Route path="/store/inbox" element={g([STORE], <StoreInbox />)} />
          <Route path="/sawmill/inbox" element={g([SAW], <WoodInbox />)} />
          <Route path="/warehouse" element={g([WH], <WarehouseList />)} />
          <Route path="/warehouse/deliveries" element={g([WH], <DeliveryRecords />)} />

          <Route path="/monitor" element={g([SUPER, PM], <LiveMonitor />)} />
          <Route path="/dashboard" element={g([SUPER, PM], <ManagementDashboard />)} />
          <Route path="/admin/users" element={g([SUPER], <Users />)} />
          <Route path="/admin/masters" element={g([SUPER], <MasterData />)} />
          <Route path="/admin/audit" element={g([SUPER], <AuditLog />)} />
          <Route path="/admin/settings" element={g([SUPER], <Settings />)} />
          <Route path="/sales-dashboard" element={g([SUPER], <SalesPerformance />, { message: 'You do not have access to the Sales Dashboard.' })} />
          <Route path="/admin/targets" element={g([SUPER], <SalesTargets />, { message: 'You do not have access to the Sales Dashboard.' })} />
          <Route path="/reports" element={g([SUPER, PM, APM, SALES], <ProductionReports />, { cost: true })} />
          <Route path="/reports/:id" element={g([SUPER, PM, APM, SALES], <ProductionReportView />, { cost: true })} />
          <Route path="/cost" element={g([], <ProductionCost />, { cost: true, message: 'You do not have access to production costs.' })} />
          <Route path="/cost/:itemId" element={g([], <CostSheet />, { cost: true, message: 'You do not have access to production costs.' })} />

          <Route path="*" element={<Empty title="Page not found" hint="This address does not match any screen." />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
