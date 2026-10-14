"""Work distribution, stage tracking, requisitions, unified QC, warehouse and delivery (Workflows B to G)."""
import copy
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from .. import models as m
from .. import workflow as wf
from ..core import (ROLE_APM, ROLE_PM, ROLE_SALES, ROLE_SAWMILL, ROLE_STORE, ROLE_SUPER, ROLE_WAREHOUSE, audit,
                    clean, current_user, deny, get_settings, hash_password, iso, next_number, parse_date,
                    req_number, req_text, require, utcnow)
from ..database import get_db
from .orders import file_exists

router = APIRouter()


def _reason(body: dict, what: str = "a reason") -> str:
    r = (body.get("reason") or "").strip()
    if not r:
        raise HTTPException(422, f"Please enter {what}.")
    return r


def _org_items(db: DbSession, user: m.User):
    return (db.query(m.OrderItem).join(m.Order)
            .filter(m.Order.org_id == user.org_id, m.Order.state == "placed"))


def _my_site_ids(db: DbSession, user: m.User) -> list[int]:
    return [s.id for s in db.query(m.Site).filter_by(org_id=user.org_id, apm_id=user.id)]


# ---------- items: monitor, work list, detail ----------
@router.get("/items")
def list_items(scope: str = "open", site_id: int = 0, apm_id: int = 0, stage: str = "", category: str = "",
               q: str = "", date_from: str = "", date_to: str = "",
               user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    """scope: open (production + warehouse), production, unassigned, warehouse, delivered, all."""
    if user.role not in (ROLE_SUPER, ROLE_PM, ROLE_APM, ROLE_WAREHOUSE) and not user.cost_permission:
        deny(user, "item list", message="Your role does not allow this action.")
    settings = get_settings(db, user.org_id)
    qry = _org_items(db, user)
    if user.role == ROLE_APM:
        qry = qry.filter(m.OrderItem.site_id.in_(_my_site_ids(db, user)))
    if user.role == ROLE_WAREHOUSE:
        qry = qry.filter(m.OrderItem.stage.in_(wf.FINISHED))
    stages = {"open": wf.PRODUCTION_STAGES + wf.WAREHOUSE_STAGES, "production": wf.PRODUCTION_STAGES,
              "unassigned": [wf.UNASSIGNED], "warehouse": wf.WAREHOUSE_STAGES, "delivered": [wf.DELIVERED],
              "assigned": wf.PRODUCTION_STAGES + wf.FINISHED}.get(scope)
    if stages:
        qry = qry.filter(m.OrderItem.stage.in_(stages))
    if site_id:
        qry = qry.filter(m.OrderItem.site_id == site_id)
    if stage:
        qry = qry.filter(m.OrderItem.stage == stage)
    if category:
        qry = qry.filter(m.OrderItem.category == category)
    d1, d2 = parse_date(date_from), parse_date(date_to)
    out = []
    for it in qry.order_by(m.Order.placed_at, m.OrderItem.id):
        b = wf.item_brief(it, settings)
        if apm_id and b.get("apm_id") != apm_id:
            continue
        od = b["order_date"][:10]
        if d1 and od < d1.isoformat() or d2 and od > d2.isoformat():
            continue
        if q and q.lower() not in " ".join(str(b.get(k, "")) for k in
                                           ("item_no", "customer", "product_name", "product_code", "site")).lower():
            continue
        if user.role == ROLE_APM:
            b["moves"] = wf.allowed_moves(it, settings)
        out.append(b)
    return out


@router.get("/items/{item_id}")
def item_detail(item_id: int, user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = wf.get_item(db, user, item_id)
    return wf.item_full(item, user, get_settings(db, user.org_id))


# ---------- assignment (Workflow B) ----------
@router.post("/items/{item_id}/assign")
def assign(item_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_PM, ROLE_SUPER)),
           db: DbSession = Depends(get_db)):
    item = wf.get_item(db, user, item_id)
    site = db.get(m.Site, int(body.get("site_id") or 0))
    if not site or site.org_id != user.org_id or not site.active:
        raise HTTPException(422, "Please select an active site.")
    if not site.apm or not site.apm.active:
        raise HTTPException(409, f"Site {site.code} has no active APM. Please map an APM to it first.")
    if item.order.state != "placed":
        raise HTTPException(409, "Only placed orders can be assigned.")
    ref = wf.item_no(item)
    if item.stage == wf.UNASSIGNED:
        item.site_id = site.id
        item.site = site
        item.assigned_at = utcnow()
        wf.record_stage(db, item, wf.ASSIGNED, user, f"Assigned to {site.code} ({site.apm.name})")
        audit(db, user, "ASSIGN", "Item", ref, f"Assigned to site {site.code}, APM {site.apm.name}")
        msg = f"{ref} assigned to {site.code}. It is now on {site.apm.name}'s work list."
    else:
        if item.site_id == site.id:
            raise HTTPException(409, f"This item is already on site {site.code}.")
        if item.stage not in wf.PRODUCTION_STAGES:
            raise HTTPException(409, "Finished items cannot be reassigned.")
        if item.stage != wf.ASSIGNED and user.role != ROLE_SUPER:
            raise HTTPException(409, "Machine Room has started, so only the Super Admin can reassign this item, "
                                     "with a reason.")
        reason = (body.get("reason") or "").strip()
        if user.role == ROLE_SUPER and not reason:
            raise HTTPException(422, "Please enter a reason for reassigning this item.")
        old = item.site.code
        item.site_id = site.id
        item.site = site
        at = utcnow()
        if item.history and item.history[-1].ended_at is None:
            item.history[-1].ended_at = at
        item.history.append(m.StageHistory(item_id=item.id, stage=item.stage, kind="reassign", started_at=at,
                                           user_id=user.id, user_name=user.name,
                                           note=f"Reassigned from {old} to {site.code}" + (f": {reason}" if reason else "")))
        audit(db, user, "REASSIGN", "Item", ref, f"Reassigned from {old} to {site.code}" + (f": {reason}" if reason else ""))
        msg = f"{ref} reassigned to {site.code}."
    db.commit()
    return {"ok": True, "message": msg, "order_status": wf.order_status(item.order)}


# ---------- stage moves (Workflow E) ----------
@router.post("/items/{item_id}/move")
def move(item_id: int, body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = wf.get_item_for_apm(db, user, item_id)
    settings = get_settings(db, user.org_id)
    to = body.get("to") or ""
    final = None
    if to == wf.FINISH_GOOD:
        final = {k: req_number(body.get(f"final_{k}"), f"Final {k.title()}", gt=0, required=False)
                 for k in ("height", "width", "length")}
    warnings = wf.move_item(db, item, to, user, settings, (body.get("note") or "").strip() or None, final)
    db.commit()
    label = "Finish Good and moved to the Product Warehouse" if to == wf.FINISH_GOOD else to
    return {"ok": True, "message": f"{wf.item_no(item)} is now {label}.", "warnings": warnings,
            "item": wf.item_full(item, user, settings)}


@router.post("/items/{item_id}/no-requisition")
def no_requisition(item_id: int, body: dict = Body(...), user: m.User = Depends(current_user),
                   db: DbSession = Depends(get_db)):
    item = wf.get_item_for_apm(db, user, item_id)
    remark = req_text(body.get("remark"), "a remark", 2, 300)
    if item.store_reqs or item.wood_reqs:
        raise HTTPException(409, "This item already has a requisition.")
    item.no_req_remark = remark
    audit(db, user, "CONFIRM", "Item", wf.item_no(item), f"No requisition needed: {remark}")
    db.commit()
    return {"ok": True, "message": "Confirmed: no requisition needed."}


@router.post("/items/{item_id}/reverse")
def reverse(item_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_PM, ROLE_SUPER)),
            db: DbSession = Depends(get_db)):
    """Undo a wrong stage update (Section 9.7). The original entry stays in the history."""
    item = wf.get_item(db, user, item_id)
    reason = _reason(body)
    if item.stage not in wf.PRODUCTION_STAGES or item.stage == wf.ASSIGNED:
        raise HTTPException(409, "Only a production stage after Assigned can be reversed here.")
    prev = [h.stage for h in item.history if h.kind in ("move", "rework", "reversal")]
    if len(prev) < 2:
        raise HTTPException(409, "There is no earlier stage to return to.")
    target = prev[-2]
    was = item.stage
    if was in (wf.MACHINE, wf.MACHINE2):
        item.machine_passes = max(0, item.machine_passes - 1)
    wf.record_stage(db, item, target, user, f"Reversed from {was}: {reason}", kind="reversal")
    audit(db, user, "REVERSE", "Item", wf.item_no(item), f"Stage {was} reversed to {target}: {reason}")
    db.commit()
    return {"ok": True, "message": f"{wf.item_no(item)} returned to {target}."}


@router.post("/items/{item_id}/remove-upholstery")
def remove_upholstery(item_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_PM)),
                      db: DbSession = Depends(get_db)):
    """BR-08: only the Production Manager, with a reason, before any upholstery result is recorded."""
    item = wf.get_item(db, user, item_id)
    reason = _reason(body)
    if not item.upholstery_added:
        raise HTTPException(409, "Upholstery has not been added to this item.")
    if item.qc and any(r.check == "upholstery" for r in item.qc.results):
        raise HTTPException(409, "An upholstery QC result is already recorded, so upholstery cannot be removed.")
    item.upholstery_added = False
    if item.stage in (wf.UPHOLSTERY, wf.UPHOLSTERY_QC):
        wf.record_stage(db, item, wf.LACQUER_QC, user, f"Upholstery removed: {reason}", kind="reversal")
    audit(db, user, "UPDATE", "Item", wf.item_no(item), f"Upholstery removed: {reason}")
    db.commit()
    return {"ok": True, "message": "Upholstery removed from this item."}


# ---------- site board and APM management (P3, P4) ----------
@router.get("/site-board")
def site_board(user: m.User = Depends(require(ROLE_PM, ROLE_SUPER)), db: DbSession = Depends(get_db)):
    sites = db.query(m.Site).filter_by(org_id=user.org_id).order_by(m.Site.code).all()
    grid: dict[int, dict[str, int]] = {s.id: {} for s in sites}
    for it in _org_items(db, user).filter(m.OrderItem.stage.in_(wf.PRODUCTION_STAGES)):
        if it.site_id in grid:
            grid[it.site_id][it.stage] = grid[it.site_id].get(it.stage, 0) + 1
    return {"stages": wf.PRODUCTION_STAGES,
            "sites": [clean({"id": s.id, "code": s.code, "name": s.name, "type": s.type, "active": s.active,
                             "apm": s.apm.name if s.apm else None, "counts": grid[s.id],
                             "total": sum(grid[s.id].values())}) for s in sites]}


def _apm_json(db: DbSession, u: m.User) -> dict:
    sites = db.query(m.Site).filter_by(org_id=u.org_id, apm_id=u.id).order_by(m.Site.code).all()
    open_items = (db.query(m.OrderItem).filter(m.OrderItem.site_id.in_([s.id for s in sites] or [0]),
                                               m.OrderItem.stage.in_(wf.PRODUCTION_STAGES)).count())
    return clean({"id": u.id, "name": u.name, "login_id": u.login_id, "phone": u.phone, "active": u.active,
                  "sites": [{"id": s.id, "code": s.code, "name": s.name} for s in sites],
                  "open_items": open_items})


@router.get("/apms")
def apms(user: m.User = Depends(require(ROLE_PM, ROLE_SUPER)), db: DbSession = Depends(get_db)):
    return [_apm_json(db, u) for u in db.query(m.User).filter_by(org_id=user.org_id, role=ROLE_APM).order_by(m.User.name)]


def _map_sites(db: DbSession, user: m.User, apm: m.User, site_ids: list[int]):
    """Move sites to an APM. Open items move with the site (Section 4.4)."""
    for sid in site_ids:
        s = db.get(m.Site, sid)
        if not s or s.org_id != user.org_id:
            raise HTTPException(422, "Please select valid sites.")
        if s.apm_id != apm.id:
            old = s.apm.name if s.apm else "nobody"
            s.apm_id = apm.id
            s.apm = apm
            audit(db, user, "MAPPING", "Site", s.code, f"Site {s.code} moved from {old} to {apm.name}; open items moved with it")


@router.post("/apms")
def add_apm(body: dict = Body(...), user: m.User = Depends(require(ROLE_PM, ROLE_SUPER)), db: DbSession = Depends(get_db)):
    name = req_text(body.get("name"), "Name", 2, 100)
    login_id = req_text(body.get("login_id"), "Login ID", 3, 60).lower()
    password = req_text(body.get("password"), "Password", 6, 60)
    if db.query(m.User).filter_by(login_id=login_id).first():
        raise HTTPException(409, f"Login ID {login_id} is already in use.")
    apm = m.User(org_id=user.org_id, name=name, login_id=login_id, phone=(body.get("phone") or "").strip() or None,
                 role=ROLE_APM, designation="Assistant Production Manager", password_hash=hash_password(password))
    db.add(apm)
    db.flush()
    _map_sites(db, user, apm, [int(x) for x in body.get("site_ids") or []])
    audit(db, user, "CREATE", "User", login_id, f"APM {name} added")
    db.commit()
    return {"ok": True, "message": f"APM {name} added.", "apm": _apm_json(db, apm)}


@router.put("/apms/{apm_id}")
def edit_apm(apm_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_PM, ROLE_SUPER)),
             db: DbSession = Depends(get_db)):
    apm = db.get(m.User, apm_id)
    if not apm or apm.org_id != user.org_id or apm.role != ROLE_APM:
        raise HTTPException(404, "APM not found.")
    if not apm.active:
        raise HTTPException(409, "This APM is deactivated.")
    if "name" in body:
        apm.name = req_text(body.get("name"), "Name", 2, 100)
    if "phone" in body:
        apm.phone = (body.get("phone") or "").strip() or None
    current = {s.id: s for s in db.query(m.Site).filter_by(org_id=user.org_id, apm_id=apm.id)}
    want = {int(x) for x in body["site_ids"] or []} if "site_ids" in body else set(current)
    for sid, s in current.items():
        if sid not in want:
            # BR-03: a site cannot be left without an APM while it has open items
            open_n = db.query(m.OrderItem).filter(m.OrderItem.site_id == sid,
                                                  m.OrderItem.stage.in_(wf.PRODUCTION_STAGES)).count()
            if open_n:
                raise HTTPException(409, f"Site {s.code} has {open_n} open item(s). Map it to another APM instead "
                                         f"of removing it.")
            s.apm_id = None
            s.apm = None
            audit(db, user, "MAPPING", "Site", s.code, f"Site {s.code} removed from {apm.name}")
    _map_sites(db, user, apm, list(want))
    audit(db, user, "UPDATE", "User", apm.login_id, "APM details or sites updated")
    db.commit()
    return {"ok": True, "message": f"{apm.name} updated.", "apm": _apm_json(db, apm)}


@router.post("/apms/{apm_id}/deactivate")
def deactivate_apm(apm_id: int, user: m.User = Depends(require(ROLE_PM, ROLE_SUPER)), db: DbSession = Depends(get_db)):
    apm = db.get(m.User, apm_id)
    if not apm or apm.org_id != user.org_id or apm.role != ROLE_APM:
        raise HTTPException(404, "APM not found.")
    sites = db.query(m.Site).filter_by(org_id=user.org_id, apm_id=apm.id).all()
    blocked = []
    for s in sites:
        if db.query(m.OrderItem).filter(m.OrderItem.site_id == s.id,
                                        m.OrderItem.stage.in_(wf.PRODUCTION_STAGES)).count():
            blocked.append(s.code)
    if blocked:
        raise HTTPException(409, f"{apm.name} has open items on {', '.join(blocked)}. Map these sites to another "
                                 f"APM before deactivating.")
    for s in sites:
        s.apm_id = None
    apm.active = False
    db.query(m.Session).filter_by(user_id=apm.id).delete()
    audit(db, user, "DEACTIVATE", "User", apm.login_id, f"APM {apm.name} deactivated")
    db.commit()
    return {"ok": True, "message": f"{apm.name} deactivated. Their name stays on past records."}


# ---------- store requisitions (Workflow C) ----------
def _req_owner(user: m.User, item: m.OrderItem) -> int:
    """A requisition belongs to the item's APM, also when the Super Admin submits it for them."""
    if user.role == ROLE_SUPER and item.site and item.site.apm_id:
        return item.site.apm_id
    return user.id


def _req_scope(db: DbSession, user: m.User, model):
    q = db.query(model).filter(model.org_id == user.org_id)
    if user.role == ROLE_APM:
        return q.filter(model.apm_id == user.id)
    allowed = (ROLE_SUPER, ROLE_PM, ROLE_STORE) if model is m.StoreRequisition else (ROLE_SUPER, ROLE_PM, ROLE_SAWMILL)
    if user.role not in allowed:
        deny(user, "requisitions", message="Your role does not allow this action.")
    return q


@router.get("/store-requisitions")
def store_reqs(status: str = "", user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    q = _req_scope(db, user, m.StoreRequisition)
    if status:
        q = q.filter(m.StoreRequisition.status.in_(status.split(",")))
    return [wf.store_req_json(r) for r in q.order_by(m.StoreRequisition.id.desc())]


def _store_lines(db: DbSession, user: m.User, lines: list) -> list[m.StoreReqLine]:
    if not lines:
        raise HTTPException(422, "Please add at least one material line.")
    mats = {x.code: x for x in db.query(m.MasterItem).filter_by(org_id=user.org_id, kind="material", active=True)}
    out = []
    for i, l in enumerate(lines, start=1):
        code = str(l.get("material_code") or "").strip()
        if not code:
            raise HTTPException(422, f"Line {i}: Please enter Raw Material Code.")
        mat = mats.get(code)
        if not mat:
            raise HTTPException(422, f"Code {code} was not found. Please select a code from the list.")
        qty = req_number(l.get("quantity"), f"Line {i} Quantity", gt=0)
        out.append(m.StoreReqLine(material_code=mat.code, material_name=mat.name, category=mat.category,
                                  details=(l.get("details") or "").strip()[:300] or None,
                                  measurement=(l.get("measurement") or "").strip()[:100] or mat.unit,
                                  quantity=qty, colour_code=(l.get("colour_code") or "").strip()[:30] or None,
                                  remarks=(l.get("remarks") or "").strip()[:300] or None))
    return out


@router.post("/store-requisitions")
def create_store_req(body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = wf.get_item_for_apm(db, user, int(body.get("item_id") or 0))
    if item.stage not in wf.PRODUCTION_STAGES:
        raise HTTPException(409, "Requisitions can be submitted only for items in production.")
    lines = _store_lines(db, user, body.get("lines") or [])
    if not body.get("confirm_duplicate"):
        open_codes = {l.material_code: r.req_no for r in item.store_reqs if r.status in ("Submitted", "Returned")
                      for l in r.lines}
        dup = [f"{l.material_code} ({open_codes[l.material_code]})" for l in lines if l.material_code in open_codes]
        if dup:
            raise HTTPException(409, {"code": "duplicate", "message": "An open requisition for this item already "
                                      f"contains material code {', '.join(dup)}. Submit anyway?"})
    settings = get_settings(db, user.org_id)
    r = m.StoreRequisition(org_id=user.org_id, req_no=next_number(db, user.org_id, "store_req", settings),
                           item_id=item.id, apm_id=_req_owner(user, item), lines=lines)
    item.store_reqs.append(r)
    item.no_req_remark = None
    audit(db, user, "CREATE", "Store Requisition", r.req_no, f"Submitted for {wf.item_no(item)} with {len(lines)} line(s)")
    db.commit()
    return {"ok": True, "message": f"Store Requisition {r.req_no} submitted to the Store Operator.", "req_no": r.req_no}


@router.put("/store-requisitions/{req_id}")
def resubmit_store_req(req_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_APM)),
                       db: DbSession = Depends(get_db)):
    r = db.get(m.StoreRequisition, req_id)
    if not r or r.org_id != user.org_id:
        raise HTTPException(404, "Requisition not found.")
    if r.apm_id != user.id and user.role != ROLE_SUPER:
        deny(user, "store requisition", r.req_no)
    if r.status != "Returned":
        raise HTTPException(409, "Only a returned requisition can be edited and resubmitted.")
    snapshot = wf.store_req_json(r)
    versions = copy.deepcopy(r.versions or [])
    versions.append({"version": r.version, "submitted_at": snapshot["submitted_at"],
                     "return_reason": r.return_reason, "returned_by": r.processed_by, "lines": snapshot["lines"]})
    r.lines = _store_lines(db, user, body.get("lines") or [])
    r.versions = versions
    r.version += 1
    r.status = "Submitted"
    r.submitted_at = utcnow()
    r.processed_at = None
    r.processed_by = None
    audit(db, user, "RESUBMIT", "Store Requisition", r.req_no, f"Resubmitted as version {r.version}")
    db.commit()
    return {"ok": True, "message": f"{r.req_no} resubmitted (version {r.version})."}


@router.post("/store-requisitions/{req_id}/process")
def process_store_req(req_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_STORE)),
                      db: DbSession = Depends(get_db)):
    r = db.get(m.StoreRequisition, req_id)
    if not r or r.org_id != user.org_id:
        raise HTTPException(404, "Requisition not found.")
    if r.status not in ("Submitted", "Partly Issued"):
        raise HTTPException(409, f"This requisition is already {r.status}.")
    action = body.get("action")
    if action == "issue":
        for l in r.lines:
            l.issued_qty = l.quantity
        r.status = "Issued"
    elif action == "partly":
        given = {int(x["id"]): x.get("issued_qty") for x in body.get("lines") or []}
        for l in r.lines:
            q = req_number(given.get(l.id), f"Issued quantity for {l.material_name}", ge=0)
            if q > l.quantity:
                raise HTTPException(422, f"Issued quantity for {l.material_name} cannot be more than {l.quantity:g}.")
            l.issued_qty = q
        if all(l.issued_qty == l.quantity for l in r.lines):
            r.status = "Issued"
        elif not any(l.issued_qty for l in r.lines):
            raise HTTPException(422, "Please enter the issued quantity for at least one line.")
        else:
            r.status = "Partly Issued"
    elif action == "return":
        if r.status != "Submitted":
            raise HTTPException(409, "A partly issued requisition cannot be returned.")
        r.return_reason = _reason(body, "the reason for returning this requisition")
        r.status = "Returned"
    else:
        raise HTTPException(422, "Unknown action.")
    r.processed_at = utcnow()
    r.processed_by = user.name
    audit(db, user, "PROCESS", "Store Requisition", r.req_no,
          f"Marked {r.status}" + (f": {r.return_reason}" if r.status == "Returned" else ""))
    db.commit()
    return {"ok": True, "message": f"{r.req_no} marked {r.status}."}


# ---------- wood requisitions (Workflow D) ----------
@router.get("/wood-requisitions")
def wood_reqs(status: str = "", user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    q = _req_scope(db, user, m.WoodRequisition)
    if status:
        q = q.filter(m.WoodRequisition.status.in_(status.split(",")))
    return [wf.wood_req_json(r) for r in q.order_by(m.WoodRequisition.id.desc())]


def _wood_fields(db: DbSession, user: m.User, body: dict) -> dict:
    woods = {x.name for x in db.query(m.MasterItem).filter_by(org_id=user.org_id, kind="wood", active=True)}
    seas = {x.name for x in db.query(m.MasterItem).filter_by(org_id=user.org_id, kind="seasoning", active=True)}
    wood = req_text(body.get("wood_category"), "Wood Category", 1, 100)
    if wood not in woods:
        raise HTTPException(422, "Please select a Wood Category from the list.")
    seasoning = req_text(body.get("seasoning"), "Wood Seasoning", 1, 50)
    if seasoning not in seas:
        raise HTTPException(422, "Please select Wood Seasoning from the list.")
    return {"wood_category": wood, "seasoning": seasoning,
            "quantity": req_number(body.get("quantity"), "Quantity of Wood", gt=0),
            "measurement": req_text(body.get("measurement"), "Measurement of Wood", 1, 200)}


@router.post("/wood-requisitions")
def create_wood_req(body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = wf.get_item_for_apm(db, user, int(body.get("item_id") or 0))
    if item.stage not in wf.PRODUCTION_STAGES:
        raise HTTPException(409, "Requisitions can be submitted only for items in production.")
    f = _wood_fields(db, user, body)
    r = m.WoodRequisition(org_id=user.org_id, req_no=next_number(db, user.org_id, "wood_req"), item_id=item.id,
                          apm_id=_req_owner(user, item), **f)
    item.wood_reqs.append(r)
    item.no_req_remark = None
    audit(db, user, "CREATE", "Wood Requisition", r.req_no, f"Submitted for {wf.item_no(item)}")
    db.commit()
    return {"ok": True, "message": f"Wood Requisition {r.req_no} submitted to the Saw-Mill Supervisor.", "req_no": r.req_no}


@router.put("/wood-requisitions/{req_id}")
def resubmit_wood_req(req_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_APM)),
                      db: DbSession = Depends(get_db)):
    r = db.get(m.WoodRequisition, req_id)
    if not r or r.org_id != user.org_id:
        raise HTTPException(404, "Requisition not found.")
    if r.apm_id != user.id and user.role != ROLE_SUPER:
        deny(user, "wood requisition", r.req_no)
    if r.status != "Returned":
        raise HTTPException(409, "Only a returned requisition can be edited and resubmitted.")
    f = _wood_fields(db, user, body)
    versions = copy.deepcopy(r.versions or [])
    versions.append({"version": r.version, "submitted_at": iso(r.submitted_at), "return_reason": r.return_reason,
                     "returned_by": r.processed_by, "wood_category": r.wood_category, "seasoning": r.seasoning,
                     "quantity": r.quantity, "measurement": r.measurement})
    for k, v in f.items():
        setattr(r, k, v)
    r.versions = versions
    r.version += 1
    r.status = "Submitted"
    r.submitted_at = utcnow()
    r.processed_at = None
    r.processed_by = None
    audit(db, user, "RESUBMIT", "Wood Requisition", r.req_no, f"Resubmitted as version {r.version}")
    db.commit()
    return {"ok": True, "message": f"{r.req_no} resubmitted (version {r.version})."}


@router.post("/wood-requisitions/{req_id}/process")
def process_wood_req(req_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_SAWMILL)),
                     db: DbSession = Depends(get_db)):
    r = db.get(m.WoodRequisition, req_id)
    if not r or r.org_id != user.org_id:
        raise HTTPException(404, "Requisition not found.")
    action = body.get("action")
    if action == "start" and r.status == "Submitted":
        r.status = "In Progress"
    elif action == "complete" and r.status in ("Submitted", "In Progress"):
        r.status = "Completed"
    elif action == "return" and r.status in ("Submitted", "In Progress"):
        r.return_reason = _reason(body, "the reason for returning this requisition")
        r.status = "Returned"
    else:
        raise HTTPException(409, f"This requisition is {r.status} and cannot be changed this way.")
    r.processed_at = utcnow()
    r.processed_by = user.name
    audit(db, user, "PROCESS", "Wood Requisition", r.req_no,
          f"Marked {r.status}" + (f": {r.return_reason}" if r.status == "Returned" else ""))
    db.commit()
    return {"ok": True, "message": f"{r.req_no} marked {r.status}."}


# ---------- unified QC (Workflow F) ----------
@router.post("/items/{item_id}/qc/result")
def qc_result(item_id: int, body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = wf.get_item_for_apm(db, user, item_id)
    check = body.get("check")
    result = body.get("result")
    if check not in wf.QC_CHECKS or result not in ("Pass", "Rework"):
        raise HTTPException(422, "Please choose Pass or Rework.")
    label, stage, making = wf.QC_CHECKS[check]
    if item.stage != stage or not item.qc:
        raise HTTPException(409, f"This item cannot record {label} yet. {stage} must be reached first.")
    note = (body.get("note") or "").strip() or None
    if result == "Rework" and not note:
        raise HTTPException(422, "Please enter a defect note for the rework.")
    photo = body.get("photo") or None
    if photo and not file_exists(db, photo):
        photo = None
    item.qc.results.append(m.QCResult(check=check, result=result, checker_name=user.name, checker_id=user.id,
                                      note=note, photo=photo))
    ref = wf.item_no(item)
    audit(db, user, "QC", "QC Report", item.qc.qc_ref, f"{label}: {result} for {ref}" + (f" - {note}" if note else ""))
    msg = f"{label}: Pass recorded."
    if result == "Rework":
        # BR-09: the item returns to its making stage; the failed result is kept
        item.rework_count += 1
        item.qc.apm_signed_by = item.qc.apm_signed_at = None
        wf.record_stage(db, item, making, user, f"Rework from {label}: {note}", kind="rework")
        msg = f"{label}: Rework recorded. {ref} returned to {making}."
    db.commit()
    return {"ok": True, "message": msg, "item": wf.item_full(item, user, get_settings(db, user.org_id))}


@router.put("/items/{item_id}/qc")
def qc_update(item_id: int, body: dict = Body(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = wf.get_item_for_apm(db, user, item_id)
    if not item.qc:
        raise HTTPException(409, "The QC report is created when the item reaches Carpenter QC.")
    if "carpenter_side" in body:
        item.qc.carpenter_side = (body.get("carpenter_side") or "").strip()[:150] or None
    if "remarks" in body:
        item.qc.remarks = (body.get("remarks") or "").strip() or None
    audit(db, user, "UPDATE", "QC Report", item.qc.qc_ref, "QC report details saved")
    db.commit()
    return {"ok": True, "message": "QC report saved."}


@router.post("/items/{item_id}/qc/sign")
def qc_sign(item_id: int, user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Digital sign-off by the APM and the Production Manager (FR-QC-06). Recorded, not blocking (DEC-11)."""
    item = wf.get_item(db, user, item_id)
    q = item.qc
    if user.role not in (ROLE_APM, ROLE_PM, ROLE_SUPER):
        deny(user, "QC sign-off", wf.item_no(item), "Only the APM and the Production Manager sign off QC reports.")
    if not q:
        raise HTTPException(409, "This item has no QC report yet.")
    required = [wf.CARPENTER_QC, wf.LACQUER_QC] + ([wf.UPHOLSTERY_QC] if item.upholstery_added else [])
    if not all(wf.qc_passed(item, s) for s in required):
        raise HTTPException(409, "The QC report can be signed off when every required check is Pass.")
    now = utcnow()
    if user.role == ROLE_APM or (user.role == ROLE_SUPER and not q.apm_signed_by):
        q.apm_signed_by, q.apm_signed_at = user.name, now
    else:
        q.pm_signed_by, q.pm_signed_at = user.name, now
    audit(db, user, "SIGNOFF", "QC Report", q.qc_ref, f"Signed off by {user.role} {user.name}")
    db.commit()
    return {"ok": True, "message": f"QC report {q.qc_ref} signed off."}


@router.get("/qc-reports")
def qc_reports(user: m.User = Depends(require(ROLE_SUPER, ROLE_PM, ROLE_APM)), db: DbSession = Depends(get_db)):
    q = (db.query(m.QCReport).join(m.OrderItem).join(m.Order).filter(m.Order.org_id == user.org_id))
    if user.role == ROLE_APM:
        q = q.filter(m.OrderItem.site_id.in_(_my_site_ids(db, user)))
    out = []
    for r in q.order_by(m.QCReport.id.desc()):
        it = r.item
        latest = wf.qc_latest(it)
        out.append(clean({
            "item_id": it.id, "qc_ref": r.qc_ref, "item_no": wf.item_no(it), "customer": it.order.customer.name,
            "product_name": it.product_name, "site": it.site.code if it.site else None, "stage": it.stage,
            "status": wf.item_status(it), "created_at": iso(r.created_at),
            "carpenter": "Pass" if wf.qc_passed(it, wf.CARPENTER_QC) else ("Rework" if "Rework" in (latest.get("carp_before"), latest.get("carp_final")) else "Pending"),
            "lacquer": "Pass" if wf.qc_passed(it, wf.LACQUER_QC) else ("Rework" if "Rework" in (latest.get("lacq_before"), latest.get("lacq_final")) else "Pending"),
            "upholstery": (latest.get("upholstery") or "Pending") if it.upholstery_added else None,
            "rework_count": it.rework_count, "apm_signed_by": r.apm_signed_by, "pm_signed_by": r.pm_signed_by,
        }))
    return out


# ---------- warehouse and delivery (Workflow G) ----------
@router.post("/items/{item_id}/warehouse")
def warehouse_action(item_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_WAREHOUSE)),
                     db: DbSession = Depends(get_db)):
    item = wf.get_item(db, user, item_id)
    settings = get_settings(db, user.org_id)
    action = body.get("action")
    now = utcnow()
    ref = wf.item_no(item)
    expected = {"pack": wf.IN_WAREHOUSE, "ready": wf.PACKED, "deliver": wf.READY}.get(action)
    if not expected:
        raise HTTPException(422, "Unknown action.")
    if item.stage != expected:
        target = {"pack": wf.PACKED, "ready": wf.READY, "deliver": wf.DELIVERED}[action]
        raise HTTPException(409, f"This item cannot move to {target} yet. {expected} must be completed first.")
    if action == "pack":
        item.packed_at = now
        wf.record_stage(db, item, wf.PACKED, user)
    elif action == "ready":
        item.ready_at = now
        wf.record_stage(db, item, wf.READY, user)
    else:
        ddate = parse_date(body.get("delivery_date"), "Delivery Date")
        if not ddate:
            raise HTTPException(422, "Please enter Delivery Date.")
        # the server clock is UTC; allow the organisation's local "today"
        if ddate > (now + timedelta(hours=14)).date():
            raise HTTPException(422, "Delivery Date cannot be in the future.")
        item.delivered_by = req_text(body.get("delivered_by"), "Delivered By", 2, 100)
        item.receiver_name = req_text(body.get("receiver_name"), "Receiver Name", 2, 100)
        item.delivery_date = ddate
        item.delivered_at = now
        wf.record_stage(db, item, wf.DELIVERED, user, f"Delivered by {item.delivered_by}; received by {item.receiver_name}")
        item.history[-1].ended_at = now
        db.flush()
        rep = wf.generate_report(db, item, None, settings)
        audit(db, user, "DELIVER", "Item", ref, f"Delivered on {ddate.isoformat()}; Production Report {rep.report_no} generated")
        db.commit()
        return {"ok": True, "message": f"{ref} delivered. Production Report {rep.report_no} generated.",
                "report_no": rep.report_no, "order_status": wf.order_status(item.order)}
    audit(db, user, "STAGE", "Item", ref, f"Marked {item.stage}")
    db.commit()
    return {"ok": True, "message": f"{ref} marked {item.stage}."}


@router.post("/items/{item_id}/warehouse/undo")
def warehouse_undo(item_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)),
                   db: DbSession = Depends(get_db)):
    """BR-10: a warehouse step can be undone only by the Super Admin, with a reason."""
    item = wf.get_item(db, user, item_id)
    reason = _reason(body)
    prev = {wf.PACKED: wf.IN_WAREHOUSE, wf.READY: wf.PACKED}.get(item.stage)
    if not prev:
        raise HTTPException(409, "Only Packed or Ready for Delivery can be undone. Delivered records are permanent.")
    was = item.stage
    if was == wf.PACKED:
        item.packed_at = None
    else:
        item.ready_at = None
    wf.record_stage(db, item, prev, user, f"{was} undone: {reason}", kind="undo")
    audit(db, user, "UNDO", "Item", wf.item_no(item), f"{was} undone: {reason}")
    db.commit()
    return {"ok": True, "message": f"{wf.item_no(item)} returned to {prev}."}
