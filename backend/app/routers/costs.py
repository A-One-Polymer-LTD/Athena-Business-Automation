"""Production Cost & Material Expense Tracking (Workflow H) and Production Reports (Workflow I)."""
import copy
from collections import defaultdict

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from .. import models as m
from .. import workflow as wf
from ..core import (ROLE_APM, ROLE_PM, ROLE_SALES, ROLE_SUPER, audit, can_view_cost, clean, current_user, deny,
                    get_settings, has_cost_permission, iso, next_number, parse_date, utcnow)
from ..database import get_db

router = APIRouter()

DELIVERED_MSG = "This item is delivered. Please give a reason; a new Production Report revision will be created."


def _viewer(user: m.User = Depends(current_user)) -> m.User:
    if not can_view_cost(user):
        deny(user, "production cost", message="You do not have access to production costs.")
    return user


def _editor(user: m.User = Depends(current_user)) -> m.User:
    if not has_cost_permission(user):
        deny(user, "production cost entry", message="You do not have permission to enter production costs.")
    return user


def _cost_item(db: DbSession, user: m.User, item_id: int) -> m.OrderItem:
    item = db.get(m.OrderItem, item_id)
    if not item or item.order.org_id != user.org_id:
        raise HTTPException(404, "Item not found.")
    return item


def _sheet(db: DbSession, item: m.OrderItem, settings: dict) -> m.CostSheet:
    if not item.cost_sheet:
        item.cost_sheet = m.CostSheet(item_id=item.id, sheet_no=next_number(db, item.order.org_id, "cost", settings))
        db.add(item.cost_sheet)
        db.flush()
    return item.cost_sheet


def _total(item: m.OrderItem) -> float:
    return round(sum(l.amount for l in item.cost_sheet.lines if not l.voided), 2) if item.cost_sheet else 0.0


def _row(item: m.OrderItem, settings: dict) -> dict:
    b = wf.item_brief(item, settings)
    lines = item.cost_sheet.lines if item.cost_sheet else []
    return clean({**{k: b.get(k) for k in ("id", "item_no", "order_no", "order_id", "customer", "product_name",
                                           "product_code", "category", "site", "stage", "status", "amount",
                                           "order_date", "delivery_date")},
                  "sheet_no": item.cost_sheet.sheet_no if item.cost_sheet else None,
                  "lines": len([l for l in lines if not l.voided]), "total_cost": _total(item)})


@router.get("/cost/items")
def cost_items(user: m.User = Depends(_viewer), db: DbSession = Depends(get_db)):
    """P5: items from site assignment onwards with their Total Recorded Production Cost (BR-17)."""
    settings = get_settings(db, user.org_id)
    q = (db.query(m.OrderItem).join(m.Order)
         .filter(m.Order.org_id == user.org_id, m.Order.state == "placed", m.OrderItem.stage != wf.UNASSIGNED)
         .order_by(m.OrderItem.id.desc()))
    return [_row(it, settings) for it in q]


@router.get("/cost/items/{item_id}")
def cost_sheet(item_id: int, user: m.User = Depends(_viewer), db: DbSession = Depends(get_db)):
    item = _cost_item(db, user, item_id)
    settings = get_settings(db, user.org_id)
    d = _row(item, settings)
    d.update(wf.cost_json(item))
    d["can_edit"] = has_cost_permission(user) and item.stage != wf.UNASSIGNED and item.order.state == "placed"
    d["delivered"] = item.stage == wf.DELIVERED
    d["order_total_cost"] = round(sum(_total(i) for i in item.order.items), 2)
    return d


def _validate_line(db: DbSession, user: m.User, body: dict) -> dict:
    """BR-15: Name of the Item, Rate > 0, Per = Pcs or Set, Amount > 0."""
    fields = {}
    name = (body.get("name") or "").strip()
    code = (body.get("material_code") or "").strip() or None
    if code:
        mat = db.query(m.MasterItem).filter_by(org_id=user.org_id, kind="material", code=code).first()
        if not mat:
            fields["name"] = f"Code {code} was not found. Please select a code from the list."
        else:
            name = name or mat.name
    if not name:
        fields["name"] = "Please enter Name of the Item."
    elif not 2 <= len(name) <= 150:
        fields["name"] = "Name of the Item must be 2 to 150 characters."
    vals = {}
    for f, label in (("rate", "Rate"), ("amount", "Amount")):
        try:
            v = round(float(body.get(f)), 2)
            if v <= 0:
                fields[f] = f"{label} must be greater than 0."
            vals[f] = v
        except (TypeError, ValueError):
            fields[f] = f"Please enter {label}."
    per = body.get("per")
    if per not in ("Pcs", "Set"):
        fields["per"] = "Please select Per (Pcs or Set)."
    if fields:
        raise HTTPException(422, {"message": "Please enter Name of the Item, Rate, Per and Amount.", "fields": fields})
    return {"name": name, "material_code": code, "rate": vals["rate"], "per": per, "amount": vals["amount"]}


def _after_delivery(db: DbSession, user: m.User, item: m.OrderItem, body: dict, settings: dict, what: str) -> str | None:
    """BR-17: after delivery a reason is needed and a new report revision is created."""
    if item.stage != wf.DELIVERED:
        return None
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, {"code": "reason_required", "message": DELIVERED_MSG})
    db.flush()
    rep = wf.generate_report(db, item, user, settings, f"{what}: {reason}")
    return rep.report_no


@router.post("/cost/items/{item_id}/lines")
def add_line(item_id: int, body: dict = Body(...), user: m.User = Depends(_editor), db: DbSession = Depends(get_db)):
    item = _cost_item(db, user, item_id)
    settings = get_settings(db, user.org_id)
    if item.stage == wf.UNASSIGNED or item.order.state != "placed":
        raise HTTPException(409, "Cost lines can be added from site assignment onwards.")
    vals = _validate_line(db, user, body)
    if item.stage == wf.DELIVERED and not (body.get("reason") or "").strip():
        raise HTTPException(422, {"code": "reason_required", "message": DELIVERED_MSG})
    sheet = _sheet(db, item, settings)
    today = utcnow().date()
    if not body.get("confirm_duplicate"):
        for l in sheet.lines:
            if (not l.voided and l.name.lower() == vals["name"].lower() and l.rate == vals["rate"]
                    and l.amount == vals["amount"] and l.entered_at.date() == today):
                raise HTTPException(409, {"code": "duplicate", "message": "This item already has a line with the same "
                                          "Name of the Item, Rate and Amount entered today. Save it anyway?"})
    line = m.CostLine(entered_by=user.name, **vals)
    sheet.lines.append(line)
    audit(db, user, "COST", "Cost Sheet", sheet.sheet_no,
          f"Line added for {wf.item_no(item)}: {vals['name']} {vals['amount']:.2f}")
    rev = _after_delivery(db, user, item, body, settings, "Cost line added")
    db.commit()
    msg = f"Cost line saved. Total Recorded Production Cost: {_total(item):,.2f}."
    if rev:
        msg += f" Production Report revision {rev} created."
    return {"ok": True, "message": msg, "total": _total(item), "revision": rev}


def _get_line(db: DbSession, user: m.User, line_id: int) -> tuple[m.CostLine, m.OrderItem]:
    line = db.get(m.CostLine, line_id)
    sheet = db.get(m.CostSheet, line.sheet_id) if line else None
    if not sheet or sheet.item.order.org_id != user.org_id:
        raise HTTPException(404, "Cost line not found.")
    if line.voided:
        raise HTTPException(409, "This line is voided and cannot be changed.")
    return line, sheet.item


@router.put("/cost/lines/{line_id}")
def edit_line(line_id: int, body: dict = Body(...), user: m.User = Depends(_editor), db: DbSession = Depends(get_db)):
    line, item = _get_line(db, user, line_id)
    settings = get_settings(db, user.org_id)
    vals = _validate_line(db, user, body)
    if item.stage == wf.DELIVERED and not (body.get("reason") or "").strip():
        raise HTTPException(422, {"code": "reason_required", "message": DELIVERED_MSG})
    hist = copy.deepcopy(line.history or [])
    hist.append({"name": line.name, "rate": line.rate, "per": line.per, "amount": line.amount,
                 "changed_by": user.name, "changed_at": iso(utcnow()), "reason": (body.get("reason") or "").strip() or None})
    line.history = hist
    for k, v in vals.items():
        setattr(line, k, v)
    audit(db, user, "COST", "Cost Sheet", item.cost_sheet.sheet_no,
          f"Line corrected for {wf.item_no(item)}: {vals['name']} {vals['amount']:.2f}")
    rev = _after_delivery(db, user, item, body, settings, "Cost line corrected")
    db.commit()
    return {"ok": True, "message": "Cost line corrected." + (f" Production Report revision {rev} created." if rev else ""),
            "total": _total(item), "revision": rev}


@router.post("/cost/lines/{line_id}/void")
def void_line(line_id: int, body: dict = Body(...), user: m.User = Depends(_editor), db: DbSession = Depends(get_db)):
    line, item = _get_line(db, user, line_id)
    settings = get_settings(db, user.org_id)
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, DELIVERED_MSG if item.stage == wf.DELIVERED else "Please enter the reason for voiding this line.")
    line.voided = True
    line.void_reason = reason
    line.voided_by = user.name
    line.voided_at = utcnow()
    audit(db, user, "COST", "Cost Sheet", item.cost_sheet.sheet_no,
          f"Line voided for {wf.item_no(item)}: {line.name} {line.amount:.2f} - {reason}")
    rev = _after_delivery(db, user, item, body, settings, "Cost line voided")
    db.commit()
    return {"ok": True, "message": "Line voided. It stays in the history and is excluded from totals."
            + (f" Production Report revision {rev} created." if rev else ""), "total": _total(item), "revision": rev}


@router.get("/cost/summary")
def cost_summary(date_from: str = "", date_to: str = "", user: m.User = Depends(_viewer), db: DbSession = Depends(get_db)):
    """FR-PC-08: recorded cost per order, per product category and per period; FR-PC-09 margin view."""
    d1, d2 = parse_date(date_from), parse_date(date_to)
    by_cat: dict = defaultdict(lambda: {"items": 0, "cost": 0.0, "amount": 0.0})
    by_month: dict = defaultdict(float)
    by_order: dict = {}
    q = (db.query(m.CostLine).join(m.CostSheet).join(m.OrderItem).join(m.Order)
         .filter(m.Order.org_id == user.org_id, m.CostLine.voided.is_(False)))
    seen = set()
    for l in q:
        day = l.entered_at.date()
        if d1 and day < d1 or d2 and day > d2:
            continue
        it = db.get(m.CostSheet, l.sheet_id).item
        cat = it.category or "Other"
        by_cat[cat]["cost"] += l.amount
        if it.id not in seen:
            seen.add(it.id)
            by_cat[cat]["items"] += 1
            by_cat[cat]["amount"] += it.amount or 0
        by_month[day.strftime("%Y-%m")] += l.amount
        o = by_order.setdefault(it.order_id, {"order_id": it.order_id, "order_no": it.order.order_no,
                                              "customer": it.order.customer.name, "items": set(), "cost": 0.0,
                                              "amount": round(sum(i.amount or 0 for i in it.order.items), 2)})
        o["items"].add(it.id)
        o["cost"] += l.amount
    return {
        "categories": [{"category": k, "items": v["items"], "cost": round(v["cost"], 2), "order_amount": round(v["amount"], 2),
                        "avg_cost": round(v["cost"] / v["items"], 2) if v["items"] else 0}
                       for k, v in sorted(by_cat.items())],
        "months": [{"month": k, "cost": round(v, 2)} for k, v in sorted(by_month.items())],
        "orders": [{**o, "items": len(o["items"]), "cost": round(o["cost"], 2)}
                   for o in sorted(by_order.values(), key=lambda x: x["order_no"], reverse=True)],
        "total": round(sum(v["cost"] for v in by_cat.values()), 2),
    }


# ---------- Production Reports (X7) ----------
def _report_scope(db: DbSession, user: m.User):
    q = (db.query(m.ProductionReport).join(m.OrderItem).join(m.Order).filter(m.Order.org_id == user.org_id))
    if user.role in (ROLE_SUPER, ROLE_PM) or (has_cost_permission(user) and user.role not in (ROLE_SALES, ROLE_APM)):
        return q
    if user.role == ROLE_SALES:
        return q.filter(m.Order.branch_id == user.branch_id)
    if user.role == ROLE_APM:
        sites = [s.id for s in db.query(m.Site).filter_by(org_id=user.org_id, apm_id=user.id)]
        return q.filter(m.OrderItem.site_id.in_(sites or [0]))
    deny(user, "Production Reports", message="You do not have access to Production Reports.")


@router.get("/production-reports")
def reports(user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    q = _report_scope(db, user).filter(m.ProductionReport.is_current.is_(True))
    return [wf.report_json(r, user) for r in q.order_by(m.ProductionReport.id.desc())]


@router.get("/production-reports/summary")
def report_summary(user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    """FR-PR-08: average lead time, rework rate and average recorded cost per category and month."""
    show_cost = can_view_cost(user)
    cats: dict = defaultdict(lambda: {"reports": 0, "lead": 0, "rework_items": 0, "cost": 0.0})
    months: dict = defaultdict(lambda: {"reports": 0, "lead": 0, "rework_items": 0, "cost": 0.0})
    for r in _report_scope(db, user).filter(m.ProductionReport.is_current.is_(True)):
        d = r.data
        month = (d.get("delivery", {}).get("delivery_date") or iso(r.generated_at))[:7]
        for bucket in (cats[d["header"].get("category") or "Other"], months[month]):
            bucket["reports"] += 1
            bucket["lead"] += d.get("lead_time_days") or 0
            bucket["rework_items"] += 1 if (d.get("qc") or {}).get("rework_count") else 0
            bucket["cost"] += d.get("cost", {}).get("total") or 0

    def rows(src, key):
        out = []
        for k, v in sorted(src.items()):
            n = v["reports"]
            out.append(clean({key: k, "reports": n, "avg_lead_days": round(v["lead"] / n, 1),
                              "rework_rate": round(v["rework_items"] / n * 100, 1),
                              "avg_cost": round(v["cost"] / n, 2) if show_cost else None}))
        return out
    return {"categories": rows(cats, "category"), "months": rows(months, "month"), "show_cost": show_cost}


@router.get("/production-reports/{report_id}")
def report_detail(report_id: int, user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    rep = _report_scope(db, user).filter(m.ProductionReport.id == report_id).first()
    if not rep:
        exists = db.get(m.ProductionReport, report_id)
        if exists and exists.org_id == user.org_id:
            deny(user, "Production Report", exists.report_no)
        raise HTTPException(404, "Production Report not found.")
    d = wf.report_json(rep, user, with_data=True)
    d["revisions"] = [clean({"id": r.id, "report_no": r.report_no, "revision": r.revision, "status": r.status,
                             "generated_at": iso(r.generated_at), "reason": r.reason, "is_current": r.is_current})
                      for r in rep.item.reports]
    return d
