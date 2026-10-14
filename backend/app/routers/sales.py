"""Sales Record (Workflow J), Sales Targets and the Super Admin Sales Dashboard (Workflow K, BR-18 to BR-27)."""
import calendar
from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from .. import models as m
from ..core import (ROLE_SALES, ROLE_SUPER, acting_sales_admin, audit, clean, current_user, deny, get_settings, iso, next_number,
                    parse_date, req_number, req_text, utcnow)
from ..database import get_db
from ..workflow import LEAD_STAGES

router = APIRouter()

MEASURES = ("sales", "collection", "delivery", "visits")
TARGET_FIELDS = ("sales", "collection", "delivery", "visits", "leads", "orders")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _dashboard_only(user: m.User = Depends(current_user)) -> m.User:
    """FR-SD-01: the server refuses every role except the Super Admin, including direct links."""
    if user.role != ROLE_SUPER:
        deny(user, "the Sales Dashboard", message="You do not have access to the Sales Dashboard.")
    return user


def _sales_or_super(user: m.User = Depends(current_user)) -> m.User:
    if user.role not in (ROLE_SALES, ROLE_SUPER):
        deny(user, "sales records", message="You do not have access to sales records.")
    return user


# ---------- periods ----------
def period_months(mode: str, year: int, period: int, fy_start: int) -> list[tuple[int, int]]:
    """Months covered by a reporting period (BR-24)."""
    if mode == "monthly":
        return [(year, min(12, max(1, period)))]
    start = fy_start if mode == "yearly" else fy_start + 3 * (min(4, max(1, period)) - 1)
    out = []
    for i in range(12 if mode == "yearly" else 3):
        mm = start + i
        out.append((year + (mm - 1) // 12, (mm - 1) % 12 + 1))
    return out


def period_label(mode: str, year: int, period: int, months: list[tuple[int, int]]) -> str:
    if mode == "monthly":
        return f"{MONTHS[months[0][1] - 1]} {months[0][0]}"
    if mode == "quarterly":
        return f"Q{period} {year} ({MONTHS[months[0][1] - 1]} to {MONTHS[months[-1][1] - 1]})"
    y2 = months[-1][0]
    return f"{year}" if y2 == year else f"FY {year}-{str(y2)[2:]}"


def _bounds(months: list[tuple[int, int]]) -> tuple[date, date]:
    y1, m1 = months[0]
    y2, m2 = months[-1]
    return date(y1, m1, 1), date(y2, m2, calendar.monthrange(y2, m2)[1])


def is_locked(db: DbSession, org_id: int, d: date) -> bool:
    return db.query(m.PeriodLock).filter_by(org_id=org_id, year=d.year, month=d.month).first() is not None


# ---------- calculations ----------
def achievement(actual: float, target: float) -> float | None:
    """BR-19: actual / target x 100; None when no target is set."""
    if not target or target <= 0:
        return None
    return actual / target * 100


def weighted_score(ach: dict, weights: dict) -> float | None:
    """BR-20: each achievement capped at 100%; measures without a target drop out and weights rescale."""
    used = {k: weights.get(k, 0) for k in MEASURES if ach.get(k) is not None}
    total_w = sum(used.values())
    if not total_w:
        return None
    return sum(min(100.0, ach[k]) * w for k, w in used.items()) / total_w


def status_for(pct: float | None, thresholds: dict) -> str | None:
    """BR-21."""
    if pct is None:
        return None
    r = round(pct)
    if r >= thresholds.get("on_track", 75):
        return "On Track"
    if r >= thresholds.get("watch", 50):
        return "Watch"
    return "Critical"


def _metric(actual: float, target: float, thresholds: dict) -> dict:
    a = achievement(actual, target)
    return clean({"actual": round(actual, 2), "target": round(target, 2) if target else None,
                  "pct": round(a) if a is not None else None, "status": status_for(a, thresholds),
                  "no_target": a is None or None})


def compute(db: DbSession, org_id: int, months: list[tuple[int, int]], settings: dict,
            admin_ids: list[int] | None = None) -> dict:
    """Per Sales Admin actuals, targets, achievement, conversion, pipeline and weighted score."""
    start, end = _bounds(months)
    mset = set(months)
    admins = db.query(m.User).filter_by(org_id=org_id, role=ROLE_SALES).order_by(m.User.name).all()
    if admin_ids is not None:
        admins = [a for a in admins if a.id in admin_ids]
    data = {a.id: {"id": a.id, "name": a.name, "branch": a.branch.name if a.branch else "", "branch_id": a.branch_id,
                   "designation": a.designation or "Sales Admin", "active": a.active,
                   "actual": dict.fromkeys(MEASURES, 0.0), "target": dict.fromkeys(TARGET_FIELDS, 0.0),
                   "leads": 0, "orders": 0, "pipeline": 0.0, "open_leads": 0} for a in admins}
    for e in db.query(m.SalesEntry).filter(m.SalesEntry.org_id == org_id, m.SalesEntry.entry_date >= start,
                                           m.SalesEntry.entry_date <= end):
        d = data.get(e.sales_admin_id)
        if d:
            d["actual"]["sales"] += e.sales
            d["actual"]["collection"] += e.collection
            d["actual"]["delivery"] += e.delivery
            d["actual"]["visits"] += e.visits
    for t in db.query(m.SalesTarget).filter(m.SalesTarget.org_id == org_id):
        d = data.get(t.sales_admin_id)
        if d and (t.year, t.month) in mset:
            for f in TARGET_FIELDS:
                d["target"][f] += getattr(t, f) or 0
    for l in db.query(m.Lead).filter(m.Lead.org_id == org_id, m.Lead.lead_date <= end):
        d = data.get(l.sales_admin_id)
        if not d:
            continue
        if l.lead_date >= start:
            d["leads"] += 1
        # BR-22: Orders = leads that became Won in the period
        if l.status == "Closed Won" and l.closed_on and start <= l.closed_on <= end:
            d["orders"] += 1
        # BR-23: open at the end of the period
        if l.status == "Open" or (l.closed_on and l.closed_on > end):
            d["pipeline"] += l.expected_value or 0
            d["open_leads"] += 1
    weights, thresholds = settings["weights"], settings["thresholds"]
    rows = []
    for d in data.values():
        if not d["active"] and not any(d["actual"].values()) and not d["leads"]:
            continue
        ach = {k: achievement(d["actual"][k], d["target"][k]) for k in MEASURES}
        score = weighted_score(ach, weights)
        conv = min(100.0, d["orders"] / d["leads"] * 100) if d["leads"] else None
        rows.append({**d, "ach": ach, "score": score, "conversion": conv,
                     "status": status_for(score, thresholds)})
    return {"rows": rows, "start": start, "end": end}


def _admin_json(r: dict, thresholds: dict) -> dict:
    return clean({
        "id": r["id"], "name": r["name"], "branch": r["branch"], "branch_id": r["branch_id"],
        "designation": r["designation"], "rank": r.get("rank"),
        "score": round(r["score"]) if r["score"] is not None else None, "status": r["status"],
        "no_target": r["score"] is None or None,
        **{k: _metric(r["actual"][k], r["target"][k], thresholds) for k in MEASURES},
        "leads": r["leads"], "leads_target": r["target"]["leads"] or None,
        "orders": r["orders"], "orders_target": r["target"]["orders"] or None,
        "conversion": round(r["conversion"]) if r["conversion"] is not None else None,
        "pipeline": round(r["pipeline"], 2), "open_leads": r["open_leads"],
    })


def _totals(rows: list[dict], thresholds: dict) -> dict:
    act = {k: sum(r["actual"][k] for r in rows) for k in MEASURES}
    tgt = {k: sum(r["target"][k] for r in rows) for k in TARGET_FIELDS}
    leads = sum(r["leads"] for r in rows)
    orders = sum(r["orders"] for r in rows)
    conv = min(100.0, orders / leads * 100) if leads else None
    return {
        **{k: _metric(act[k], tgt[k], thresholds) for k in MEASURES},
        "leads": _metric(leads, tgt["leads"], thresholds),
        "orders": _metric(orders, tgt["orders"], thresholds),
        "conversion": clean({"pct": round(conv) if conv is not None else None, "status": status_for(conv, thresholds),
                             "no_leads": conv is None or None}),
        "pipeline": {"value": round(sum(r["pipeline"] for r in rows), 2),
                     "open_leads": sum(r["open_leads"] for r in rows)},
    }


def lead_json(l: m.Lead, with_admin: dict | None = None) -> dict:
    d = clean({"id": l.id, "lead_no": l.lead_no, "lead_date": iso(l.lead_date), "customer_name": l.customer_name,
               "customer_phone": l.customer_phone, "expected_value": l.expected_value, "stage": l.stage,
               "status": l.status, "lost_reason": l.lost_reason if l.stage == "Lost" else None,
               "next_followup": iso(l.next_followup), "remarks": l.remarks, "closed_on": iso(l.closed_on)})
    if with_admin:
        d.update(with_admin)
    return d


# ---------- Sales Dashboard (X6) ----------
@router.get("/sales/dashboard")
def dashboard(mode: str = "monthly", year: int = 0, period: int = 0, branch_id: int = 0, sales_admin_id: int = 0,
              rank_by: str = "score", user: m.User = Depends(_dashboard_only), db: DbSession = Depends(get_db)):
    settings = get_settings(db, user.org_id)
    today = date.today()
    fy = int(settings.get("fiscal_year_start", 1))
    if mode not in ("monthly", "quarterly", "yearly"):
        mode = "monthly"
    year = year or today.year
    if not period:
        period = today.month if mode == "monthly" else ((today.month - fy) % 12) // 3 + 1
    months = period_months(mode, year, period, fy)
    th = settings["thresholds"]
    res = compute(db, user.org_id, months, settings)
    rows = res["rows"]
    if branch_id:
        rows = [r for r in rows if r["branch_id"] == branch_id]

    # BR-25: highest first; ties go to the higher sales actual, then alphabetical order
    def key(r):
        v = r["score"] if rank_by == "score" else (r["actual"]["visits"] if rank_by == "visits" else r["ach"].get(rank_by))
        return (-(v if v is not None else -1), -r["actual"]["sales"], r["name"])
    rows.sort(key=key)
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    shown = [r for r in rows if not sales_admin_id or r["id"] == sales_admin_id]

    # branch-wise performance
    branches = []
    for b in db.query(m.Branch).filter_by(org_id=user.org_id).order_by(m.Branch.name):
        br = [r for r in res["rows"] if r["branch_id"] == b.id]
        if not br or (branch_id and b.id != branch_id):
            continue
        t = _totals(br, th)
        branches.append({"id": b.id, "branch": b.name, "sales_admins": len(br),
                         **{k: t[k] for k in ("sales", "collection", "delivery", "visits")}})

    # trend: actual against target by month
    if mode == "monthly":
        y, mo = months[0]
        trend_months = [((y * 12 + mo - 1 - i) // 12, (y * 12 + mo - 1 - i) % 12 + 1) for i in range(5, -1, -1)]
    else:
        trend_months = months
    ids = {r["id"] for r in shown}
    trend = []
    for ym in trend_months:
        one = compute(db, user.org_id, [ym], settings, list(ids))["rows"]
        trend.append({"label": f"{MONTHS[ym[1] - 1]} {str(ym[0])[2:]}",
                      "actual": round(sum(r["actual"]["sales"] for r in one), 2),
                      "target": round(sum(r["target"]["sales"] for r in one), 2),
                      "collection": round(sum(r["actual"]["collection"] for r in one), 2),
                      "delivery": round(sum(r["actual"]["delivery"] for r in one), 2)})

    # sales funnel: leads dated in the period
    names = {r["id"]: {"sales_admin": r["name"], "branch": r["branch"]} for r in res["rows"]}
    leads = [l for l in db.query(m.Lead).filter(m.Lead.org_id == user.org_id, m.Lead.lead_date >= res["start"],
                                                m.Lead.lead_date <= res["end"]).order_by(m.Lead.lead_date.desc(), m.Lead.id.desc())
             if l.sales_admin_id in ids]
    stage_counts = [{"stage": s, "count": sum(1 for l in leads if l.stage == s)} for s in LEAD_STAGES]
    w = settings["weights"]
    return {
        "mode": mode, "year": year, "period": period, "label": period_label(mode, year, period, months),
        "months": [f"{MONTHS[mm - 1]} {yy}" for yy, mm in months],
        "summary": _totals(shown, th),
        "ranking": [_admin_json(r, th) for r in shown],
        "branches": branches, "trend": trend,
        "funnel": [lead_json(l, names.get(l.sales_admin_id)) for l in leads],
        "stage_counts": stage_counts,
        "formula": f"Sales {w['sales']}%, Collection {w['collection']}%, Delivery {w['delivery']}%, Visits {w['visits']}%",
        "thresholds": th, "weights": w, "fiscal_year_start": fy,
        "sales_admins": [{"id": r["id"], "name": r["name"], "branch_id": r["branch_id"]} for r in res["rows"]],
    }


# ---------- Sales Admin: own summary (DEC-24: own targets and totals only) ----------
@router.get("/sales/summary")
def my_summary(mode: str = "monthly", year: int = 0, period: int = 0, user: m.User = Depends(_sales_or_super),
               sales_admin_id: int = 0, db: DbSession = Depends(get_db)):
    settings = get_settings(db, user.org_id)
    today = date.today()
    fy = int(settings.get("fiscal_year_start", 1))
    year = year or today.year
    if not period:
        period = today.month if mode == "monthly" else ((today.month - fy) % 12) // 3 + 1
    months = period_months(mode, year, period, fy)
    target_id = user.id if user.role == ROLE_SALES else sales_admin_id
    rows = compute(db, user.org_id, months, settings, [target_id])["rows"]
    if not rows:
        return {"label": period_label(mode, year, period, months)}
    d = _admin_json(rows[0], settings["thresholds"])
    for k in ("rank", "score", "status"):
        d.pop(k, None)
    d["label"] = period_label(mode, year, period, months)
    return d


# ---------- sales entries (S5) ----------
def entry_json(e: m.SalesEntry, locked: bool = False, extra: dict | None = None) -> dict:
    d = clean({"id": e.id, "entry_no": e.entry_no, "entry_date": iso(e.entry_date), "sales": e.sales,
               "collection": e.collection, "delivery": e.delivery, "visits": e.visits, "remarks": e.remarks,
               "locked": locked or None, "updated_at": iso(e.updated_at or e.created_at)})
    for k in ("sales", "collection", "delivery", "visits"):
        d.setdefault(k, 0)
    if extra:
        d.update(extra)
    return d


def _locks(db: DbSession, org_id: int) -> set[tuple[int, int]]:
    return {(l.year, l.month) for l in db.query(m.PeriodLock).filter_by(org_id=org_id)}


@router.get("/sales/entries")
def entries(date_from: str = "", date_to: str = "", sales_admin_id: int = 0, user: m.User = Depends(_sales_or_super),
            db: DbSession = Depends(get_db)):
    q = db.query(m.SalesEntry).filter(m.SalesEntry.org_id == user.org_id)
    if user.role == ROLE_SALES:
        # FR-SR-04: a Sales Admin's request for another Sales Admin's records is refused
        if sales_admin_id and sales_admin_id != user.id:
            deny(user, "another Sales Admin's sales records", message="You can see only your own sales records.")
        q = q.filter(m.SalesEntry.sales_admin_id == user.id)
    elif sales_admin_id:
        q = q.filter(m.SalesEntry.sales_admin_id == sales_admin_id)
    d1, d2 = parse_date(date_from), parse_date(date_to)
    if d1:
        q = q.filter(m.SalesEntry.entry_date >= d1)
    if d2:
        q = q.filter(m.SalesEntry.entry_date <= d2)
    locks = _locks(db, user.org_id)
    names = {}
    if user.role == ROLE_SUPER:
        names = {u.id: {"sales_admin": u.name, "branch": u.branch.name if u.branch else None}
                 for u in db.query(m.User).filter_by(org_id=user.org_id, role=ROLE_SALES)}
    return [entry_json(e, (e.entry_date.year, e.entry_date.month) in locks, names.get(e.sales_admin_id))
            for e in q.order_by(m.SalesEntry.entry_date.desc())]


def _entry_values(body: dict) -> dict:
    vals = {
        "sales": req_number(body.get("sales") or 0, "Sales Amount", ge=0),
        "collection": req_number(body.get("collection") or 0, "Collection Amount", ge=0),
        "delivery": req_number(body.get("delivery") or 0, "Delivery Amount", ge=0),
    }
    visits = req_number(body.get("visits") or 0, "Client Visits", ge=0)
    if visits != int(visits):
        raise HTTPException(422, "Client Visits must be a whole number.")
    vals["visits"] = int(visits)
    if not any(vals.values()):
        raise HTTPException(422, "At least one of Sales, Collection, Delivery or Client Visits must be greater than 0.")
    remarks = (body.get("remarks") or "").strip()
    if len(remarks) > 500:
        raise HTTPException(422, "Remarks can be up to 500 characters.")
    vals["remarks"] = remarks or None
    return vals


def _locked_message(d: date) -> str:
    return f"Entries for {MONTHS[d.month - 1]} {d.year} are locked or in the future. Please contact the Super Admin."


@router.post("/sales/entries")
def save_entry(body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    owner = acting_sales_admin(db, user, body)
    d = parse_date(body.get("entry_date"), "Entry Date")
    if not d:
        raise HTTPException(422, "Please enter Entry Date.")
    if d > date.today() or (is_locked(db, user.org_id, d) and user.role != ROLE_SUPER):
        raise HTTPException(409, _locked_message(d))
    existing = db.query(m.SalesEntry).filter_by(sales_admin_id=owner.id, entry_date=d).first()
    if existing and not body.get("id"):
        # BR-18: one entry per date; open the existing one for editing instead
        return {"existing": True, "entry": entry_json(existing),
                "message": f"You already have an entry for {d.strftime('%d-%b-%Y')}. It has been opened for editing."}
    vals = _entry_values(body)
    if existing:
        if existing.id != int(body["id"]):
            raise HTTPException(409, f"You already have an entry for {d.strftime('%d-%b-%Y')}.")
        for k, v in vals.items():
            setattr(existing, k, v)
        existing.updated_at = utcnow()
        audit(db, user, "UPDATE", "Sales Entry", existing.entry_no, f"Entry for {d.isoformat()} updated")
        db.commit()
        return {"ok": True, "entry": entry_json(existing), "message": f"Sales entry {existing.entry_no} updated."}
    if body.get("id"):
        # date changed on an existing entry
        e = db.get(m.SalesEntry, int(body["id"]))
        if not e or e.sales_admin_id != owner.id:
            raise HTTPException(404, "Sales entry not found.")
        if is_locked(db, user.org_id, e.entry_date) and user.role != ROLE_SUPER:
            raise HTTPException(409, _locked_message(e.entry_date))
        e.entry_date = d
        for k, v in vals.items():
            setattr(e, k, v)
        e.updated_at = utcnow()
        audit(db, user, "UPDATE", "Sales Entry", e.entry_no, f"Entry moved to {d.isoformat()} and updated")
        db.commit()
        return {"ok": True, "entry": entry_json(e), "message": f"Sales entry {e.entry_no} updated."}
    e = m.SalesEntry(org_id=user.org_id, entry_no=next_number(db, user.org_id, "sales_entry", year=d.year),
                     sales_admin_id=owner.id, branch_id=owner.branch_id, entry_date=d, **vals)
    db.add(e)
    audit(db, user, "CREATE", "Sales Entry", e.entry_no, f"Entry for {d.isoformat()} added")
    db.commit()
    return {"ok": True, "entry": entry_json(e), "message": f"Sales entry {e.entry_no} saved."}


@router.put("/sales/entries/{entry_id}")
def admin_edit_entry(entry_id: int, body: dict = Body(...), user: m.User = Depends(_dashboard_only),
                     db: DbSession = Depends(get_db)):
    """Changes to a locked period can be made only by the Super Admin, with a reason (Workflow J)."""
    e = db.get(m.SalesEntry, entry_id)
    if not e or e.org_id != user.org_id:
        raise HTTPException(404, "Sales entry not found.")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, "Please enter a reason for changing this entry.")
    for k, v in _entry_values(body).items():
        setattr(e, k, v)
    e.updated_at = utcnow()
    audit(db, user, "UPDATE", "Sales Entry", e.entry_no, f"Changed by Super Admin: {reason}")
    db.commit()
    return {"ok": True, "message": f"Sales entry {e.entry_no} updated."}


# ---------- leads (S6) ----------
@router.get("/sales/leads")
def leads(date_from: str = "", date_to: str = "", status: str = "", user: m.User = Depends(_sales_or_super),
          db: DbSession = Depends(get_db)):
    q = db.query(m.Lead).filter(m.Lead.org_id == user.org_id)
    if user.role == ROLE_SALES:
        q = q.filter(m.Lead.sales_admin_id == user.id)
    d1, d2 = parse_date(date_from), parse_date(date_to)
    if d1:
        q = q.filter(m.Lead.lead_date >= d1)
    if d2:
        q = q.filter(m.Lead.lead_date <= d2)
    if status:
        q = q.filter(m.Lead.status == status)
    names = {}
    if user.role == ROLE_SUPER:
        names = {u.id: {"sales_admin": u.name, "branch": u.branch.name if u.branch else None}
                 for u in db.query(m.User).filter_by(org_id=user.org_id, role=ROLE_SALES)}
    return [lead_json(l, names.get(l.sales_admin_id)) for l in q.order_by(m.Lead.lead_date.desc(), m.Lead.id.desc())]


def _apply_lead(db: DbSession, user: m.User, lead: m.Lead, body: dict):
    d = parse_date(body.get("lead_date"), "Lead Date")
    if not d:
        raise HTTPException(422, "Please enter Lead Date.")
    if d > date.today():
        raise HTTPException(422, "Lead Date cannot be in the future.")
    lead.lead_date = d
    lead.customer_name = req_text(body.get("customer_name"), "Customer Name", 2, 100)
    phone = "".join(ch for ch in (body.get("customer_phone") or "") if ch.isdigit() or ch == "+")
    if phone and not 7 <= len(phone.lstrip("+")) <= 15:
        raise HTTPException(422, "Please enter a valid mobile number.")
    lead.customer_phone = phone or None
    lead.expected_value = req_number(body.get("expected_value") or 0, "Expected Value", ge=0)
    stage = body.get("stage") or "New"
    if stage not in LEAD_STAGES:
        raise HTTPException(422, "Please select a Stage from the list.")
    reason = (body.get("lost_reason") or "").strip()
    if stage == "Lost" and not reason:
        raise HTTPException(422, "Please enter the reason this lead was lost.")
    follow = parse_date(body.get("next_followup"), "Next Follow-up Date")
    if follow and follow < d:
        raise HTTPException(422, "Next Follow-up Date must be on or after the Lead Date.")
    lead.next_followup = follow
    remarks = (body.get("remarks") or "").strip()
    if len(remarks) > 500:
        raise HTTPException(422, "Remarks can be up to 500 characters.")
    lead.remarks = remarks or None
    # BR-27: status follows the stage
    was = lead.status
    lead.stage = stage
    lead.status = {"Won": "Closed Won", "Lost": "Closed Lost"}.get(stage, "Open")
    lead.lost_reason = reason if stage == "Lost" else None
    if lead.status == "Open":
        lead.closed_on = None
    elif was != lead.status or not lead.closed_on:
        lead.closed_on = max(date.today(), d)


@router.post("/sales/leads")
def add_lead(body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    owner = acting_sales_admin(db, user, body)
    lead = m.Lead(org_id=user.org_id, sales_admin_id=owner.id, branch_id=owner.branch_id)
    _apply_lead(db, user, lead, body)
    if lead.customer_phone and not body.get("confirm_duplicate"):
        dup = db.query(m.Lead).filter_by(sales_admin_id=owner.id, customer_phone=lead.customer_phone, status="Open").first()
        if dup:
            raise HTTPException(409, {"code": "duplicate", "message": f"You already have an open lead for this phone "
                                      f"number ({dup.lead_no}, {dup.customer_name}). Save this lead anyway?"})
    lead.lead_no = next_number(db, user.org_id, "lead", year=lead.lead_date.year)
    db.add(lead)
    audit(db, user, "CREATE", "Lead", lead.lead_no, f"Lead for {lead.customer_name} added at stage {lead.stage}")
    db.commit()
    return {"ok": True, "lead": lead_json(lead), "message": f"Lead {lead.lead_no} saved."}


@router.put("/sales/leads/{lead_id}")
def edit_lead(lead_id: int, body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    lead = db.get(m.Lead, lead_id)
    if not lead or lead.org_id != user.org_id:
        raise HTTPException(404, "Lead not found.")
    if user.role != ROLE_SUPER and (user.role != ROLE_SALES or lead.sales_admin_id != user.id):
        deny(user, "another Sales Admin's lead", lead.lead_no, "You can edit only your own leads.")
    was = lead.stage
    _apply_lead(db, user, lead, body)
    audit(db, user, "UPDATE", "Lead", lead.lead_no,
          f"Stage {was} -> {lead.stage}" if was != lead.stage else "Lead updated")
    db.commit()
    return {"ok": True, "lead": lead_json(lead), "message": f"Lead {lead.lead_no} updated."}


# ---------- targets and period locks (X8) ----------
@router.get("/sales/targets")
def targets(year: int, month: int, user: m.User = Depends(_dashboard_only), db: DbSession = Depends(get_db)):
    existing = {t.sales_admin_id: t for t in db.query(m.SalesTarget).filter_by(org_id=user.org_id, year=year, month=month)}
    rows = []
    for a in db.query(m.User).filter_by(org_id=user.org_id, role=ROLE_SALES, active=True).order_by(m.User.name):
        t = existing.get(a.id)
        rows.append({"sales_admin_id": a.id, "name": a.name, "login_id": a.login_id,
                     "branch": a.branch.name if a.branch else "",
                     **{f: (getattr(t, f) if t else 0) or 0 for f in TARGET_FIELDS}})
    return {"year": year, "month": month, "locked": (year, month) in _locks(db, user.org_id), "rows": rows,
            "locks": [{"year": y, "month": mo} for y, mo in sorted(_locks(db, user.org_id), reverse=True)]}


def _save_targets(db: DbSession, user: m.User, year: int, month: int, rows: list[dict], by_login: bool = False) -> list[str]:
    errors = []
    admins = {(a.login_id if by_login else a.id): a
              for a in db.query(m.User).filter_by(org_id=user.org_id, role=ROLE_SALES, active=True)}
    parsed = []
    for i, r in enumerate(rows, start=1):
        key = str(r.get("login_id") or "").strip().lower() if by_login else r.get("sales_admin_id")
        a = admins.get(key)
        if not a:
            errors.append(f"Row {i}: Sales Admin {key or ''} was not found.")
            continue
        vals = {}
        for f in TARGET_FIELDS:
            try:
                v = float(r.get(f) or 0)
                if v < 0:
                    raise ValueError
                vals[f] = round(v, 2)
            except (TypeError, ValueError):
                errors.append(f"Row {i} ({a.name}): {f.title()} target must be 0 or more.")
        parsed.append((a, vals))
    if errors:
        return errors
    existing = {t.sales_admin_id: t for t in db.query(m.SalesTarget).filter_by(org_id=user.org_id, year=year, month=month)}
    for a, vals in parsed:
        t = existing.get(a.id)
        if not t:
            t = m.SalesTarget(org_id=user.org_id, sales_admin_id=a.id, year=year, month=month)
            db.add(t)
        for f, v in vals.items():
            setattr(t, f, v)
    return []


@router.put("/sales/targets")
def save_targets(body: dict = Body(...), user: m.User = Depends(_dashboard_only), db: DbSession = Depends(get_db)):
    year, month = int(body.get("year") or 0), int(body.get("month") or 0)
    if not (2000 < year < 2100 and 1 <= month <= 12):
        raise HTTPException(422, "Please choose a month.")
    if (year, month) in _locks(db, user.org_id):
        raise HTTPException(409, f"{MONTHS[month - 1]} {year} is locked. Unlock the period to change its targets.")
    errors = _save_targets(db, user, year, month, body.get("rows") or [], bool(body.get("by_login")))
    if errors:
        db.rollback()
        raise HTTPException(422, {"message": "Nothing was saved. Please correct these rows.", "rows": errors})
    audit(db, user, "TARGETS", "Sales Target", f"{year}-{month:02d}",
          f"Targets {'imported' if body.get('by_login') else 'saved'} for {MONTHS[month - 1]} {year}")
    db.commit()
    return {"ok": True, "message": f"Targets for {MONTHS[month - 1]} {year} saved."}


@router.post("/sales/targets/copy")
def copy_targets(body: dict = Body(...), user: m.User = Depends(_dashboard_only), db: DbSession = Depends(get_db)):
    year, month = int(body.get("year") or 0), int(body.get("month") or 0)
    py, pm = (year, month - 1) if month > 1 else (year - 1, 12)
    if (year, month) in _locks(db, user.org_id):
        raise HTTPException(409, f"{MONTHS[month - 1]} {year} is locked.")
    prev = db.query(m.SalesTarget).filter_by(org_id=user.org_id, year=py, month=pm).all()
    if not prev:
        raise HTTPException(409, f"No targets were found for {MONTHS[pm - 1]} {py}.")
    _save_targets(db, user, year, month, [{"sales_admin_id": t.sales_admin_id, **{f: getattr(t, f) for f in TARGET_FIELDS}}
                                          for t in prev])
    audit(db, user, "TARGETS", "Sales Target", f"{year}-{month:02d}", f"Copied from {MONTHS[pm - 1]} {py}")
    db.commit()
    return {"ok": True, "message": f"Targets copied from {MONTHS[pm - 1]} {py}."}


@router.post("/sales/locks")
def set_lock(body: dict = Body(...), user: m.User = Depends(_dashboard_only), db: DbSession = Depends(get_db)):
    year, month = int(body.get("year") or 0), int(body.get("month") or 0)
    lock = bool(body.get("locked"))
    today = date.today()
    existing = db.query(m.PeriodLock).filter_by(org_id=user.org_id, year=year, month=month).first()
    label = f"{MONTHS[month - 1]} {year}"
    if lock:
        if (year, month) >= (today.year, today.month):
            raise HTTPException(409, "Only a closed period (a month that has ended) can be locked.")
        if not existing:
            db.add(m.PeriodLock(org_id=user.org_id, year=year, month=month, locked_by=user.name))
        audit(db, user, "LOCK", "Sales Period", f"{year}-{month:02d}", f"{label} locked")
    else:
        reason = (body.get("reason") or "").strip()
        if not reason:
            raise HTTPException(422, "Please enter a reason for unlocking this period.")
        if existing:
            db.delete(existing)
        audit(db, user, "UNLOCK", "Sales Period", f"{year}-{month:02d}", f"{label} unlocked: {reason}")
    db.commit()
    return {"ok": True, "message": f"{label} {'locked' if lock else 'unlocked'}."}
