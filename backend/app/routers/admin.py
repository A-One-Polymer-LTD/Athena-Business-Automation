"""Super Admin: users, master data, sites, settings, audit log; plus dashboards (S1, X1, X2)."""
from collections import defaultdict
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from .. import models as m
from .. import workflow as wf
from ..core import (DEFAULT_SETTINGS, ROLE_APM, ROLE_PM, ROLE_SALES, ROLE_SUPER, ROLES, audit, clean, create_session,
                    current_user, get_settings, hash_password, iso, parse_date, req_text, require)
from ..database import get_db
from .orders import user_json
from .sales import MONTHS, period_label, period_months

router = APIRouter()

MASTER_KINDS = {
    "product_category": "Product Category", "product": "Product", "material_category": "Raw Material Category",
    "material": "Raw Material", "wood": "Wood Category", "seasoning": "Wood Seasoning", "colour": "Colour",
}
CODE_RULES = {"product": 6, "material": 7, "product_category": 2, "material_category": 3}


# ---------- users and roles (X3) ----------
@router.get("/users")
def users(user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    return [user_json(u) for u in db.query(m.User).filter_by(org_id=user.org_id).order_by(m.User.role, m.User.name)]


def _apply_user(db: DbSession, admin: m.User, u: m.User, body: dict, new: bool):
    u.name = req_text(body.get("name"), "Name", 2, 100)
    role = body.get("role")
    if role not in ROLES:
        raise HTTPException(422, "Please select a role.")
    if not new and role != u.role:
        if u.role == ROLE_APM and db.query(m.Site).filter_by(apm_id=u.id).count():
            raise HTTPException(409, "This APM is mapped to sites. Map the sites to another APM before changing the role.")
        if u.id == admin.id:
            raise HTTPException(409, "You cannot change your own role.")
    u.role = role
    u.phone = (body.get("phone") or "").strip()[:30] or None
    u.designation = (body.get("designation") or "").strip()[:100] or None
    if role == ROLE_SALES:
        b = db.get(m.Branch, int(body.get("branch_id") or 0))
        if not b or b.org_id != admin.org_id:
            raise HTTPException(422, "Please select the Sales Admin's branch.")
        u.branch_id = b.id
        u.branch = b
    else:
        u.branch_id = None
        u.branch = None
    # cost entry is a permission, not a role (DEC-17)
    u.cost_permission = bool(body.get("cost_granted")) and role not in (ROLE_SUPER, ROLE_PM)


@router.post("/users")
def add_user(body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    login_id = req_text(body.get("login_id"), "User ID", 3, 60).lower()
    if db.query(m.User).filter_by(login_id=login_id).first():
        raise HTTPException(409, f"User ID {login_id} is already in use.")
    password = req_text(body.get("password"), "Password", 6, 60)
    u = m.User(org_id=user.org_id, login_id=login_id, password_hash=hash_password(password))
    _apply_user(db, user, u, body, True)
    db.add(u)
    audit(db, user, "CREATE", "User", login_id, f"User {u.name} added as {u.role}"
          + (" with cost-entry permission" if u.cost_permission else ""))
    db.commit()
    return {"ok": True, "message": f"User {u.name} added."}


@router.put("/users/{user_id}")
def edit_user(user_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    u = db.get(m.User, user_id)
    if not u or u.org_id != user.org_id:
        raise HTTPException(404, "User not found.")
    had_cost = u.cost_permission
    _apply_user(db, user, u, body, False)
    if body.get("password"):
        u.password_hash = hash_password(req_text(body.get("password"), "Password", 6, 60))
        audit(db, user, "PASSWORD", "User", u.login_id, "Password reset by the Super Admin")
    if had_cost != u.cost_permission:
        audit(db, user, "PERMISSION", "User", u.login_id,
              f"Cost-entry permission {'granted' if u.cost_permission else 'removed'}")
    audit(db, user, "UPDATE", "User", u.login_id, f"User updated ({u.role})")
    db.commit()
    return {"ok": True, "message": f"User {u.name} updated."}


@router.post("/users/{user_id}/active")
def set_active(user_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    u = db.get(m.User, user_id)
    if not u or u.org_id != user.org_id:
        raise HTTPException(404, "User not found.")
    active = bool(body.get("active"))
    if not active:
        if u.id == user.id:
            raise HTTPException(409, "You cannot deactivate your own account.")
        if u.role == ROLE_APM:
            sites = db.query(m.Site).filter_by(apm_id=u.id).all()
            busy = [s.code for s in sites if db.query(m.OrderItem).filter(
                m.OrderItem.site_id == s.id, m.OrderItem.stage.in_(wf.PRODUCTION_STAGES)).count()]
            if busy:
                raise HTTPException(409, f"{u.name} has open items on {', '.join(busy)}. Map these sites to another "
                                         f"APM before deactivating.")
            for s in sites:
                s.apm_id = None
        db.query(m.Session).filter_by(user_id=u.id).delete()  # deactivated users lose access at once
    u.active = active
    u.failed_logins = 0
    u.locked_until = None
    audit(db, user, "ACTIVATE" if active else "DEACTIVATE", "User", u.login_id,
          f"User {u.name} {'activated' if active else 'deactivated'}")
    db.commit()
    return {"ok": True, "message": f"{u.name} {'activated' if active else 'deactivated'}."}


@router.post("/users/{user_id}/impersonate")
def impersonate(user_id: int, user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    """The Super Admin opens any user's account to see and act exactly as that user. Logged in the audit log."""
    if user.role != ROLE_SUPER:
        raise HTTPException(403, "Only the Super Admin can open another user's account.")
    u = db.get(m.User, user_id)
    if not u or u.org_id != user.org_id:
        raise HTTPException(404, "User not found.")
    if not u.active:
        raise HTTPException(409, f"{u.name} is deactivated. Activate the account first.")
    token = create_session(db, u)
    audit(db, user, "IMPERSONATE", "User", u.login_id, f"Super Admin {user.name} opened the account of {u.name} ({u.role})")
    db.commit()
    return {"token": token, "user": user_json(u), "settings": get_settings(db, user.org_id),
            "message": f"You are now using Athena OS as {u.name} ({u.role})."}


# ---------- branches and sites ----------
@router.post("/branches")
def save_branch(body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    name = req_text(body.get("name"), "Branch Name", 2, 100)
    code = req_text(body.get("code"), "Branch Code", 1, 20).upper()
    b = db.get(m.Branch, int(body["id"])) if body.get("id") else None
    clash = db.query(m.Branch).filter_by(org_id=user.org_id, code=code).first()
    if clash and (not b or clash.id != b.id):
        raise HTTPException(409, f"Branch code {code} already exists.")
    if not b:
        b = m.Branch(org_id=user.org_id)
        db.add(b)
    b.name, b.code = name, code
    b.active = body.get("active", True) is not False
    audit(db, user, "MASTER", "Branch", code, f"Branch {name} saved")
    db.commit()
    return {"ok": True, "message": f"Branch {name} saved."}


@router.post("/sites")
def save_site(body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    code = req_text(body.get("code"), "Site Code", 2, 20).upper()
    name = req_text(body.get("name"), "Site Name", 2, 100)
    s = db.get(m.Site, int(body["id"])) if body.get("id") else None
    clash = db.query(m.Site).filter_by(org_id=user.org_id, code=code).first()
    if clash and (not s or clash.id != s.id):
        raise HTTPException(409, f"Site code {code} already exists.")
    if not s:
        s = m.Site(org_id=user.org_id)
        db.add(s)
    active = body.get("active", True) is not False
    open_n = db.query(m.OrderItem).filter(m.OrderItem.site_id == s.id,
                                          m.OrderItem.stage.in_(wf.PRODUCTION_STAGES)).count() if s.id else 0
    apm_id = int(body.get("apm_id") or 0) or None
    if apm_id:
        apm = db.get(m.User, apm_id)
        if not apm or apm.role != ROLE_APM or not apm.active or apm.org_id != user.org_id:
            raise HTTPException(422, "Please select an active APM.")
    if open_n and (not active or not apm_id):
        raise HTTPException(409, f"Site {code} has {open_n} open item(s), so it must stay active with an APM.")
    if s.id and s.apm_id != apm_id:
        audit(db, user, "MAPPING", "Site", code, "Site-to-APM mapping changed; open items moved with the site")
    s.code, s.name, s.active, s.apm_id = code, name, active, apm_id
    s.type = "Contract" if body.get("type") == "Contract" else "In-house"
    audit(db, user, "MASTER", "Site", code, f"Site {name} saved")
    db.commit()
    return {"ok": True, "message": f"Site {code} saved."}


# ---------- master data (X4) ----------
def _master_json(x: m.MasterItem) -> dict:
    return clean({"id": x.id, "kind": x.kind, "code": x.code, "name": x.name, "category": x.category,
                  "unit": x.unit, "active": x.active})


@router.get("/masters/{kind}")
def masters(kind: str, user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    if kind not in MASTER_KINDS:
        raise HTTPException(404, "Unknown master list.")
    return [_master_json(x) for x in db.query(m.MasterItem).filter_by(org_id=user.org_id, kind=kind)
            .order_by(m.MasterItem.code)]


def _check_master(db: DbSession, org_id: int, kind: str, row: dict, existing_id: int | None = None) -> tuple[dict | None, str | None]:
    code = str(row.get("code") or "").strip()
    name = str(row.get("name") or "").strip()
    category = str(row.get("category") or "").strip() or None
    if not name:
        return None, "Please enter Name."
    if kind in ("wood", "seasoning"):
        code = code or name
    if not code:
        return None, "Please enter Code."
    if kind in CODE_RULES and (not code.isdigit() or len(code) != CODE_RULES[kind]):
        return None, f"Code {code} must be a {CODE_RULES[kind]}-digit number."
    if kind in ("product", "material"):
        parent = "product_category" if kind == "product" else "material_category"
        if not category:
            return None, "Please enter Category."
        if not db.query(m.MasterItem).filter_by(org_id=org_id, kind=parent, name=category).first():
            return None, f"Category {category} was not found in the {MASTER_KINDS[parent]} list."
    clash = db.query(m.MasterItem).filter_by(org_id=org_id, kind=kind, code=code).first()
    if clash and clash.id != existing_id:
        return None, f"Code {code} already exists."
    return {"code": code, "name": name, "category": category, "unit": str(row.get("unit") or "").strip() or None}, None


@router.post("/masters/{kind}")
def save_master(kind: str, body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    if kind not in MASTER_KINDS:
        raise HTTPException(404, "Unknown master list.")
    x = db.get(m.MasterItem, int(body["id"])) if body.get("id") else None
    if x and (x.org_id != user.org_id or x.kind != kind):
        raise HTTPException(404, "Record not found.")
    vals, err = _check_master(db, user.org_id, kind, body, x.id if x else None)
    if err:
        raise HTTPException(422, err)
    if not x:
        x = m.MasterItem(org_id=user.org_id, kind=kind)
        db.add(x)
    if x.id and kind in ("product_category", "material_category") and x.name != vals["name"]:
        # products and materials refer to their category by name, so a rename carries through
        child = "product" if kind == "product_category" else "material"
        db.query(m.MasterItem).filter_by(org_id=user.org_id, kind=child, category=x.name).update({"category": vals["name"]})
    for k, v in vals.items():
        setattr(x, k, v)
    x.active = body.get("active", True) is not False
    audit(db, user, "MASTER", MASTER_KINDS[kind], x.code, f"{x.name} saved" + ("" if x.active else " (retired)"))
    db.commit()
    return {"ok": True, "message": f"{MASTER_KINDS[kind]} {x.name} saved."}


@router.post("/masters/{kind}/import")
def import_master(kind: str, body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    """FR-SA-05: Excel import with row-by-row errors. Nothing is saved unless every row is valid."""
    if kind not in MASTER_KINDS:
        raise HTTPException(404, "Unknown master list.")
    rows = body.get("rows") or []
    if not rows:
        raise HTTPException(422, "The file has no rows.")
    errors, good, seen = [], [], set()
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        vals, err = _check_master(db, user.org_id, kind, r)
        if not err and vals["code"] in seen:
            err = f"Code {vals['code']} is repeated in the file."
        if err:
            errors.append(f"Row {i}: {err}")
        else:
            seen.add(vals["code"])
            good.append(vals)
    if errors:
        raise HTTPException(422, {"message": f"Nothing was imported. {len(errors)} row(s) need correction.", "rows": errors})
    for vals in good:
        db.add(m.MasterItem(org_id=user.org_id, kind=kind, **vals))
    audit(db, user, "IMPORT", MASTER_KINDS[kind], None, f"{len(good)} row(s) imported")
    db.commit()
    return {"ok": True, "message": f"{len(good)} {MASTER_KINDS[kind]} row(s) imported."}


# ---------- settings and audit (FR-SA-06, FR-SA-07) ----------
@router.get("/settings")
def read_settings(user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    return get_settings(db, user.org_id)


@router.put("/settings")
def save_settings(body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    org = db.get(m.Organisation, user.org_id)
    new = dict(org.settings or {})
    if "organisation" in body:
        org.name = req_text(body["organisation"], "Organisation Name", 2, 150)
    for k in DEFAULT_SETTINGS:
        if k in body:
            new[k] = body[k]
    w = {**DEFAULT_SETTINGS["weights"], **(new.get("weights") or {})}
    try:
        w = {k: float(v) for k, v in w.items()}
    except (TypeError, ValueError):
        raise HTTPException(422, "Ranking weights must be numbers.")
    if any(v < 0 for v in w.values()) or round(sum(w.values()), 2) != 100:
        raise HTTPException(422, "Ranking weights must total 100%.")
    new["weights"] = w
    th = {**DEFAULT_SETTINGS["thresholds"], **(new.get("thresholds") or {})}
    try:
        th = {k: float(v) for k, v in th.items()}
    except (TypeError, ValueError):
        raise HTTPException(422, "Status thresholds must be numbers.")
    if not 0 < th["watch"] < th["on_track"] <= 100:
        raise HTTPException(422, "The Watch threshold must be below the On Track threshold.")
    new["thresholds"] = th
    try:
        new["fiscal_year_start"] = min(12, max(1, int(new.get("fiscal_year_start", 1))))
        if "stage_limit_days" in new:
            new["stage_limit_days"] = {k: max(1, int(v)) for k, v in new["stage_limit_days"].items()}
    except (TypeError, ValueError):
        raise HTTPException(422, "Stage time limits must be whole numbers of days.")
    for k, v in (new.get("prefixes") or {}).items():
        if not str(v).strip() or len(str(v)) > 6 or not str(v).replace("-", "").isalnum():
            raise HTTPException(422, "Number prefixes must be 1 to 6 letters or digits.")
        new["prefixes"][k] = str(v).strip().upper()
    if new.get("number_format", "lakh") not in ("lakh", "international"):
        raise HTTPException(422, "Please select a number format.")
    if new.get("date_format", "DD-MMM-YYYY") not in ("DD-MMM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"):
        raise HTTPException(422, "Please select a date format.")
    if "timezone" in new:
        try:
            ZoneInfo(str(new["timezone"]))
        except Exception:
            raise HTTPException(422, "Please enter a valid time zone, for example Asia/Dhaka.")
    org.settings = new
    audit(db, user, "SETTINGS", "Organisation", org.name, "Organisation settings updated")
    db.commit()
    return {"ok": True, "message": "Settings saved.", "settings": get_settings(db, user.org_id)}


@router.get("/audit")
def audit_log(q: str = "", action: str = "", date_from: str = "", date_to: str = "", limit: int = 2000,
              user: m.User = Depends(require(ROLE_SUPER)), db: DbSession = Depends(get_db)):
    qry = db.query(m.AuditLog).filter(m.AuditLog.org_id == user.org_id)
    if action:
        qry = qry.filter(m.AuditLog.action == action)
    d1, d2 = parse_date(date_from), parse_date(date_to)
    if d1:
        qry = qry.filter(m.AuditLog.at >= d1)
    if d2:
        qry = qry.filter(m.AuditLog.at < d2 + timedelta(days=1))
    if q:
        like = f"%{q}%"
        qry = qry.filter(m.AuditLog.detail.ilike(like) | m.AuditLog.ref.ilike(like) | m.AuditLog.user_name.ilike(like)
                         | m.AuditLog.entity.ilike(like))
    return [clean({"id": a.id, "at": iso(a.at), "user": a.user_name, "role": a.role, "action": a.action,
                   "entity": a.entity, "ref": a.ref, "detail": a.detail})
            for a in qry.order_by(m.AuditLog.id.desc()).limit(min(limit, 5000))]


# ---------- dashboards ----------
def _period(db: DbSession, user: m.User, mode: str, year: int, period: int):
    settings = get_settings(db, user.org_id)
    today = date.today()
    fy = int(settings.get("fiscal_year_start", 1))
    mode = mode if mode in ("monthly", "quarterly", "yearly") else "monthly"
    year = year or today.year
    if not period:
        period = today.month if mode == "monthly" else ((today.month - fy) % 12) // 3 + 1
    months = period_months(mode, year, period, fy)
    return settings, mode, year, period, months


def _order_stats(orders: list[m.Order], months: list[tuple[int, int]], mode: str, year: int, fy: int) -> dict:
    """Totals exclude drafts and cancelled orders (BR-13)."""
    mset = set(months)
    live = [o for o in orders if o.state in ("placed", "returned") and o.placed_at]
    cur = [o for o in live if (o.placed_at.year, o.placed_at.month) in mset]
    counts: dict[str, int] = defaultdict(int)
    for o in cur:
        counts[wf.order_status(o)] += 1
    amount = sum(sum(i.amount or 0 for i in o.items) for o in cur)
    # chart: by month within a quarter/year; by month for the trailing six months in monthly mode
    if mode == "monthly":
        y, mo = months[0]
        chart_months = [((y * 12 + mo - 1 - i) // 12, (y * 12 + mo - 1 - i) % 12 + 1) for i in range(5, -1, -1)]
    else:
        chart_months = months
    series = []
    for ym in chart_months:
        os_ = [o for o in live if (o.placed_at.year, o.placed_at.month) == ym]
        series.append({"label": f"{MONTHS[ym[1] - 1]} {str(ym[0])[2:]}", "orders": len(os_),
                       "amount": round(sum(sum(i.amount or 0 for i in o.items) for o in os_), 2)})
    return {
        "cards": {"total_orders": len(cur), "total_amount": round(amount, 2), "pending": counts["Pending"] + counts["Returned"],
                  "in_production": counts["In Production"], "completed": counts["Completed"],
                  "delivered": counts["Delivered"] + counts["Partly Delivered"]},
        "status": [{"status": k, "count": v} for k, v in counts.items() if v],
        "series": series,
    }


@router.get("/dashboard/sales-admin")
def sales_admin_dashboard(mode: str = "monthly", year: int = 0, period: int = 0,
                          user: m.User = Depends(require(ROLE_SALES)), db: DbSession = Depends(get_db)):
    """S1: own-branch order dashboard (FR-SO-06, FR-SO-07)."""
    settings, mode, year, period, months = _period(db, user, mode, year, period)
    q = db.query(m.Order).filter_by(org_id=user.org_id)
    if user.role == ROLE_SALES:
        q = q.filter_by(branch_id=user.branch_id)
    orders = q.all()
    d = _order_stats(orders, months, mode, year, int(settings.get("fiscal_year_start", 1)))
    d.update({"label": period_label(mode, year, period, months), "mode": mode, "year": year, "period": period,
              "branch": user.branch.name if user.branch else "All branches",
              "drafts": sum(1 for o in orders if o.state == "draft"),
              "returned": sum(1 for o in orders if o.state == "returned")})
    return d


@router.get("/dashboard/management")
def management_dashboard(mode: str = "monthly", year: int = 0, period: int = 0,
                         user: m.User = Depends(require(ROLE_SUPER, ROLE_PM)), db: DbSession = Depends(get_db)):
    """X2: orders by status and period, items per stage and site, QC pass and rework rates, delayed items."""
    settings, mode, year, period, months = _period(db, user, mode, year, period)
    orders = db.query(m.Order).filter_by(org_id=user.org_id).all()
    d = _order_stats(orders, months, mode, year, int(settings.get("fiscal_year_start", 1)))
    items = [i for o in orders if o.state == "placed" for i in o.items]
    open_items = [i for i in items if i.stage in wf.PRODUCTION_STAGES + wf.WAREHOUSE_STAGES]
    by_stage: dict[str, int] = defaultdict(int)
    by_site: dict[str, int] = defaultdict(int)
    for i in open_items:
        by_stage[i.stage] += 1
        if i.site and i.stage in wf.PRODUCTION_STAGES:
            by_site[i.site.code] += 1
    mset = set(months)
    passes = reworks = 0
    for r in (db.query(m.QCResult).join(m.QCReport).join(m.OrderItem).join(m.Order).filter(m.Order.org_id == user.org_id)):
        if (r.at.year, r.at.month) in mset:
            if r.result == "Pass":
                passes += 1
            else:
                reworks += 1
    delayed = [wf.item_brief(i, settings) for i in open_items if wf.is_delayed(i, settings)]
    total_qc = passes + reworks
    d.update({
        "label": period_label(mode, year, period, months), "mode": mode, "year": year, "period": period,
        "stages": [{"stage": s, "count": by_stage[s]} for s in wf.PRODUCTION_STAGES + wf.WAREHOUSE_STAGES if by_stage[s]],
        "sites": [{"site": k, "count": v} for k, v in sorted(by_site.items())],
        "qc": {"checks": total_qc, "pass": passes, "rework": reworks,
               "pass_rate": round(passes / total_qc * 100, 1) if total_qc else None,
               "rework_rate": round(reworks / total_qc * 100, 1) if total_qc else None},
        "open_items": len(open_items), "delayed_count": len(delayed), "delayed": delayed[:50],
        "unassigned": sum(1 for i in items if i.stage == wf.UNASSIGNED),
        "in_warehouse": sum(1 for i in items if i.stage in wf.WAREHOUSE_STAGES),
    })
    return d
