# Athena OS

Athena OS is the business automation platform for made-to-order manufacturers. It gives every customer
order one digital record that each team updates: showroom sales, production planning, store and wood
requisitions, stage tracking, unified quality control, warehouse and delivery, production cost,
Production Reports and sales performance.

## Run it

Double-click **`start.bat`** (Windows), then open **http://localhost:8000**.

The first start creates the Python environment, installs the web packages, builds the web app and loads
the sample data. To load fresh sample data later, stop the app and run `reset-demo-data.bat`.

### Demo accounts

Password for every account: **`Athena@123`**

| User ID | Role | Notes |
| --- | --- | --- |
| `superadmin` | Super Admin | Live monitor, dashboards, Sales Dashboard, targets, users, master data, audit log, settings |
| `sales1` … `sales8` | Sales Admin | Three branches (North: 1, 5, 8 · South: 2, 6, 7 · East: 3, 4) |
| `pm` | Production Manager | Orders, work distribution, site board, APMs, production cost |
| `apm01` | Assistant Production Manager | Sites PS-01, PS-02, PS-03, CS-01 |
| `apm02` | Assistant Production Manager | Sites PS-04, PS-05, PS-06 |
| `store` | Store Operator | Store requisition inbox |
| `sawmill` | Saw-Mill Supervisor | Wood requisition inbox |
| `warehouse` | Warehouse / Delivery | Warehouse list, delivery records |

## Development

```bat
rem API (http://127.0.0.1:8000, docs at /api/docs)
cd backend
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

rem Web app with hot reload (http://localhost:5173, proxies /api to the API)
cd frontend
npm run dev
```

End-to-end API test (walks one order from New Order to Delivered and checks the key test scenarios):

```bat
cd backend
.venv\Scripts\python tests\test_flow.py
```

## Technology

| Layer | Choice |
| --- | --- |
| Web app | React 19, TypeScript, Vite, Tailwind CSS, Recharts |
| API | Python, FastAPI, SQLAlchemy |
| Database | SQLite by default. Set `DATABASE_URL` (for example `mysql+pymysql://user:pass@host/athena`) for MySQL |
| Files | Product and QC images in `backend/uploads`, served only to signed-in users |

## Structure

```
backend/app
  models.py      data model (orders, items, requisitions, QC, costs, reports, sales, audit)
  core.py        settings, sign-in and sessions, role checks, audit log, numbering
  workflow.py    stage rules, QC rules, order status, Production Report generation
  routers/       REST API: orders, production, costs and reports, sales, administration
  seed.py        sample data
frontend/src
  components/    design system (ui.tsx), DataTable, Layout, QC sheet
  lib/           API client, sign-in, formatting, navigation, Excel helpers
  pages/         one folder per role area
```

## Branding

The brand colours live in `frontend/src/index.css` (`--color-brand-*`, `--color-gold-*`) and the logo
mark in `frontend/public/logo-mark.svg`. Replace that file and adjust the two colour scales to apply the
official identity everywhere.
