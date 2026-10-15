"""Workflow engine: production stages, QC rules, order status, serialisers and Production Reports.

Implements BRD Figure 5 and business rules BR-02 to BR-14.
"""
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session as DbSession

from . import models as m
from .core import (ROLE_APM, ROLE_PM, ROLE_SALES, ROLE_SUPER, ROLE_WAREHOUSE, audit, can_view_cost, clean,
                   deny, has_cost_permission, iso, next_number, utcnow)

UNASSIGNED = "Unassigned"
ASSIGNED = "Assigned"
MACHINE = "Machine Room"
SITE = "Production Site"
MACHINE2 = "Machine Room (2nd pass)"
FORM_READY = "Form/Design Ready"
CARPENTER = "Carpenter"
CARPENTER_QC = "Carpenter QC"
LACQUER = "Lacquer"
LACQUER_QC = "Lacquer QC"
UPHOLSTERY = "Upholstery"
UPHOLSTERY_QC = "Upholstery QC"
FINISH_GOOD = "Finish Good"
IN_WAREHOUSE = "In Warehouse"
PACKED = "Packed"
READY = "Ready for Delivery"
DELIVERED = "Delivered"

PRODUCTION_STAGES = [ASSIGNED, MACHINE, SITE, MACHINE2, FORM_READY, CARPENTER, CARPENTER_QC, LACQUER,
                     LACQUER_QC, UPHOLSTERY, UPHOLSTERY_QC]
WAREHOUSE_STAGES = [IN_WAREHOUSE, PACKED, READY]
ALL_STAGES = PRODUCTION_STAGES + [FINISH_GOOD] + WAREHOUSE_STAGES + [DELIVERED]
QC_STAGES = [CARPENTER_QC, LACQUER_QC, UPHOLSTERY_QC]
FINISHED = WAREHOUSE_STAGES + [DELIVERED]

QC_CHECKS = {
    "carp_before": ("Before Carpenter Fitting QC", CARPENTER_QC, CARPENTER),
    "carp_final": ("Final Carpenter Fitting QC", CARPENTER_QC, CARPENTER),
    "lacq_before": ("Before Colour QC", LACQUER_QC, LACQUER),
    "lacq_final": ("Final Colour QC", LACQUER_QC, LACQUER),
    "upholstery": ("Upholstery QC", UPHOLSTERY_QC, UPHOLSTERY),
}

LEAD_STAGES = ["New", "Contacted", "Visit / Measurement", "Quotation Sent", "Negotiation", "Won", "Lost"]


# ---------- access ----------
def item_no(item: m.OrderItem) -> str:
    return f"{item.order.order_no or 'DRAFT'}/{item.seq}"


def can_see_item(user: m.User, item: m.OrderItem) -> bool:
    if item.order.org_id != user.org_id:
        return False
    if user.role in (ROLE_SUPER, ROLE_PM):
        return True
    if user.role == ROLE_APM:
        return bool(item.site and item.site.apm_id == user.id)
    if user.role == ROLE_SALES:
        return item.order.branch_id == user.branch_id
    if user.role == ROLE_WAREHOUSE:
        return item.stage in FINISHED
    return has_cost_permission(user)


def get_item(db: DbSession, user: m.User, item_id: int) -> m.OrderItem:
    item = db.get(m.OrderItem, item_id)
    if not item or item.order.org_id != user.org_id:
        raise HTTPException(404, "Item not found.")
    if not can_see_item(user, item):
        deny(user, "item", item_no(item))
    return item


def get_item_for_apm(db: DbSession, user: m.User, item_id: int) -> m.OrderItem:
    """Items an APM may act on: only their own sites."""
    item = get_item(db, user, item_id)
    if user.role not in (ROLE_APM, ROLE_SUPER):
        deny(user, "production update", item_no(item), "Only the responsible APM can update this item.")
    return item


# ---------- status ----------
def order_status(order: m.Order) -> str:
    if order.state == "draft":
        return "Draft"
    if order.state == "returned":
        return "Returned"
    if order.state == "cancelled":
        return "Cancelled"
    stages = [i.stage for i in order.items]
    if not stages or any(s == UNASSIGNED for s in stages):
        return "Pending"
    if all(s == DELIVERED for s in stages):
        return "Delivered"
    if any(s == DELIVERED for s in stages):
        return "Partly Delivered"
    if all(s in FINISHED for s in stages):
        return "Completed"
    return "In Production"


def days_in_stage(item: m.OrderItem) -> int:
    if not item.stage_since:
        return 0
    return max(0, (utcnow() - item.stage_since).days)


def is_delayed(item: m.OrderItem, settings: dict) -> bool:
    if item.stage == DELIVERED or item.order.state != "placed":
        return False
    promised = item.order.promised_date
    if promised and date.today() > promised:
        return True
    if item.stage in PRODUCTION_STAGES:
        limits = settings.get("stage_limit_days", {})
        limit = limits.get(item.stage, limits.get("default", 5))
        return days_in_stage(item) > limit
    return False


def in_rework(item: m.OrderItem) -> bool:
    return bool(item.history) and item.history[-1].kind == "rework" and item.stage in (CARPENTER, LACQUER, UPHOLSTERY)


def item_status(item: m.OrderItem) -> str:
    """Status badge text (BRD Section 10.4)."""
    if item.order.state == "cancelled":
        return "Cancelled"
    if item.order.state == "draft":
        return "Draft"
    if item.stage == UNASSIGNED:
        return "Pending"
    if in_rework(item):
        return "Rework"
    if item.stage in QC_STAGES:
        return "At QC"
    return item.stage


# ---------- QC ----------
def qc_latest(item: m.OrderItem) -> dict:
    latest = {}
    if item.qc:
        for r in item.qc.results:
            latest[r.check] = r.result
    return latest


def qc_passed(item: m.OrderItem, stage: str) -> bool:
    """BR-06: a QC stage passes only when every check of that stage is Pass."""
    latest = qc_latest(item)
    checks = [k for k, v in QC_CHECKS.items() if v[1] == stage]
    return all(latest.get(c) == "Pass" for c in checks)


def qc_todo(item: m.OrderItem, user: m.User) -> str | None:
    """QC input this user still owes: 'result' for a QC request sent to them, or 'signoff' once every check
    is Pass."""
    q = item.qc
    if not q:
        return None
    role = user.role
    if item.stage in QC_STAGES and not qc_passed(item, item.stage) and can_review_qc(user, item):
        return "result"
    required = [CARPENTER_QC, LACQUER_QC] + ([UPHOLSTERY_QC] if item.upholstery_added else [])
    if all(qc_passed(item, s) for s in required) and (
            role == ROLE_APM and not q.apm_signed_by or role == ROLE_PM and not q.pm_signed_by
            or role == ROLE_SUPER and not (q.apm_signed_by and q.pm_signed_by)):
        return "signoff"
    return None


def ensure_qc_report(db: DbSession, item: m.OrderItem, settings: dict) -> m.QCReport:
    if not item.qc:
        item.qc = m.QCReport(item_id=item.id, qc_ref=next_number(db, item.order.org_id, "qc", settings))
        db.add(item.qc)
        db.flush()
    return item.qc


# ---------- QC requests: send to a reviewer, approve or reject, track (Workflow F) ----------
def qc_reviewers(db: DbSession, item: m.OrderItem) -> list[m.User]:
    """Who can review a QC stage: the site's APM first (BRD: the APM records QC), then other APMs and the
    Production Managers."""
    users = (db.query(m.User).filter(m.User.org_id == item.order.org_id, m.User.active.is_(True),
                                      m.User.role.in_([ROLE_APM, ROLE_PM])).order_by(m.User.name).all())
    site_apm = item.site.apm_id if item.site else None
    return sorted(users, key=lambda u: (u.id != site_apm, u.role != ROLE_APM, u.name))


def pending_qc_request(item: m.OrderItem, stage: str | None = None) -> m.QCRequest | None:
    stage = stage or item.stage
    return next((r for r in reversed(item.qc_requests) if r.stage == stage and r.status == "Pending"), None)


def submit_qc_request(db: DbSession, item: m.OrderItem, stage: str, user: m.User | None, settings: dict,
                      reviewer_id: int | None = None, note: str | None = None,
                      at: datetime | None = None) -> m.QCRequest:
    """Open a QC request for the stage the item has just reached, addressed to the chosen reviewer."""
    candidates = qc_reviewers(db, item)
    if reviewer_id:
        reviewer = next((u for u in candidates if u.id == int(reviewer_id)), None)
        if not reviewer:
            raise HTTPException(422, "Please choose the QC reviewer from the list (an active APM or Production Manager).")
    else:
        reviewer = candidates[0] if candidates else None
    if not reviewer:
        raise HTTPException(409, "No active APM or Production Manager can review this QC. Please add one first.")
    rounds = [r.round for r in item.qc_requests if r.stage == stage]
    req = m.QCRequest(org_id=item.order.org_id, item_id=item.id,
                      request_no=next_number(db, item.order.org_id, "qc_request", settings), stage=stage,
                      round=max(rounds) + 1 if rounds else 1, status="Pending",
                      submitted_by_id=user.id if user else None, submitted_by=user.name if user else "System",
                      submitted_at=at or utcnow(), note=note, reviewer_id=reviewer.id, reviewer=reviewer.name,
                      results=[], reassignments=[])
    item.qc_requests.append(req)
    db.add(req)
    audit(db, user, "QC_REQUEST", "QC Request", req.request_no,
          f"{stage} of {item_no(item)} sent to {reviewer.name} ({reviewer.role}) for review"
          + (f", round {req.round}" if req.round > 1 else ""), org_id=item.order.org_id)
    return req


def sync_qc_requests(db: DbSession, items: list[m.OrderItem], settings: dict) -> bool:
    """Keep requests in step with the items: an item waiting at a QC stage always has one pending request
    (items that reached QC before requests existed get one addressed to the site's APM), and a pending request
    is withdrawn when the item has left that stage (for example after a stage reversal)."""
    changed = False
    for it in items:
        for r in it.qc_requests:
            if r.status == "Pending" and r.stage != it.stage:
                r.status, r.decided_at = "Withdrawn", utcnow()
                r.feedback = r.feedback or f"Withdrawn: the item moved to {it.stage}."
                changed = True
        if it.stage in QC_STAGES and it.qc and not qc_passed(it, it.stage) and not pending_qc_request(it):
            last = next((h for h in reversed(it.history) if h.stage == it.stage), None)
            sender = db.get(m.User, last.user_id) if last and last.user_id else None
            try:
                submit_qc_request(db, it, it.stage, sender, settings, at=last.started_at if last else None)
                changed = True
            except HTTPException:
                pass
    if changed:
        db.commit()
    return changed


def sync_org_qc_requests(db: DbSession, org_id: int, settings: dict) -> None:
    """sync_qc_requests for the items that can need it: at a QC stage, or with a pending request."""
    items = (db.query(m.OrderItem).join(m.Order)
             .filter(m.Order.org_id == org_id,
                     or_(m.OrderItem.stage.in_(QC_STAGES),
                         m.OrderItem.qc_requests.any(m.QCRequest.status == "Pending"))).all())
    sync_qc_requests(db, items, settings)


def can_review_qc(user: m.User, item: m.OrderItem) -> bool:
    """Only the reviewer the request was sent to records its results; the Super Admin can act for anyone."""
    req = pending_qc_request(item)
    return bool(req) and (user.role == ROLE_SUPER or req.reviewer_id == user.id)


def apply_qc_result(db: DbSession, item: m.OrderItem, check: str, result: str, user: m.User,
                    note: str | None = None, photo: str | None = None) -> str:
    """Record one check result on the unified QC report and update the stage's QC request (BR-06, BR-09)."""
    label, stage, making = QC_CHECKS[check]
    req = pending_qc_request(item, stage)
    item.qc.results.append(m.QCResult(check=check, result=result, checker_name=user.name, checker_id=user.id,
                                      note=note, photo=photo))
    ref = item_no(item)
    audit(db, user, "QC", "QC Report", item.qc.qc_ref, f"{label}: {result} for {ref}" + (f" - {note}" if note else ""))
    if req:
        req.results = list(req.results or []) + [clean({"check": label, "result": result, "by": user.name,
                                                        "at": iso(utcnow()), "note": note, "photo": photo})]
    msg = f"{label}: Pass recorded."
    if result == "Rework":
        # BR-09: the item returns to its making stage; the failed result is kept
        item.rework_count += 1
        item.qc.apm_signed_by = item.qc.apm_signed_at = None
        record_stage(db, item, making, user, f"Rework from {label}: {note}", kind="rework")
        msg = f"{label}: Rework recorded. {ref} returned to {making}."
        if req:
            req.status, req.decided_by, req.decided_at, req.feedback = "Rejected", user.name, utcnow(), note
            audit(db, user, "QC_REJECT", "QC Request", req.request_no, f"Rejected ({label}): {note}")
            msg = f"{req.request_no} rejected. {ref} returned to {making} for rework."
    elif req and qc_passed(item, stage):
        req.status, req.decided_by, req.decided_at = "Approved", user.name, utcnow()
        req.feedback = req.feedback or note
        audit(db, user, "QC_APPROVE", "QC Request", req.request_no, f"{stage} approved for {ref}")
        msg = f"{req.request_no} approved: {stage} passed. The APM can now move {ref} on."
    return msg


_NEXT_AFTER = {CARPENTER_QC: "Move to Lacquer", LACQUER_QC: "Finish Good or + Upholstery", UPHOLSTERY_QC: "Finish Good"}
_MAKING = {CARPENTER_QC: CARPENTER, LACQUER_QC: LACQUER, UPHOLSTERY_QC: UPHOLSTERY}


def qc_request_json(r: m.QCRequest, user: m.User | None = None, with_item: bool = False) -> dict:
    it = r.item
    end = r.decided_at or utcnow()
    d = clean({
        "id": r.id, "request_no": r.request_no, "stage": r.stage, "round": r.round, "status": r.status,
        "submitted_by": r.submitted_by, "submitted_by_id": r.submitted_by_id, "submitted_at": iso(r.submitted_at),
        "note": r.note, "reviewer": r.reviewer, "reviewer_id": r.reviewer_id,
        "decided_by": r.decided_by, "decided_at": iso(r.decided_at), "feedback": r.feedback,
        "results": r.results or None, "reassignments": r.reassignments or None,
        "waiting_hours": round((end - r.submitted_at).total_seconds() / 3600, 1),
        "checks": [QC_CHECKS[k][0] for k in QC_CHECKS if QC_CHECKS[k][1] == r.stage],
    })
    if r.status == "Pending":
        latest = qc_latest(it)
        d["open_checks"] = [QC_CHECKS[k][0] for k in QC_CHECKS
                            if QC_CHECKS[k][1] == r.stage and latest.get(k) != "Pass"]
        d["next_action"] = f"{r.reviewer} to review: approve or reject"
    elif r.status == "Approved":
        d["next_action"] = (f"APM: {_NEXT_AFTER[r.stage]}" if it.stage == r.stage
                            else f"Done. The item moved on to {it.stage}.")
    elif r.status == "Rejected":
        making = _MAKING[r.stage]
        if any(x.stage == r.stage and x.round > r.round for x in it.qc_requests):
            d["next_action"] = f"Reworked and sent again (round {r.round + 1})"
        else:
            d["next_action"] = f"Rework at {making}, then send to {r.stage} again"
    if user:
        d["can_review"] = r.status == "Pending" and (user.role == ROLE_SUPER or r.reviewer_id == user.id)
        d["can_reassign"] = r.status == "Pending" and (
            user.role in (ROLE_SUPER, ROLE_PM) or user.id in (r.submitted_by_id, r.reviewer_id)
            or (user.role == ROLE_APM and bool(it.site) and it.site.apm_id == user.id))
    if with_item:
        o = it.order
        d.update(clean({"item_id": it.id, "item_no": item_no(it), "order_no": o.order_no,
                        "customer": o.customer.name, "product_name": it.product_name,
                        "product_code": it.product_code, "site": it.site.code if it.site else None,
                        "apm": it.site.apm.name if it.site and it.site.apm else None, "item_stage": it.stage,
                        "image": it.images[0].filename if it.images else None,
                        "qc_ref": it.qc.qc_ref if it.qc else None}))
    return d


def qc_tracker(item: m.OrderItem, user: m.User | None = None) -> list[dict]:
    """Each QC stage of the item, in order, with its latest status and every request round."""
    stages = [CARPENTER_QC, LACQUER_QC] + ([UPHOLSTERY_QC] if item.upholstery_added else [])
    out = []
    for st in stages:
        reqs = [r for r in item.qc_requests if r.stage == st]
        passed = bool(item.qc) and qc_passed(item, st)
        latest = reqs[-1] if reqs else None
        if latest and latest.status != "Withdrawn":
            status = latest.status
        elif passed:
            status = "Approved"
        elif item.stage == st:
            status = "Pending"
        else:
            status = "Not started"
        out.append(clean({"stage": st, "status": status, "passed": passed or None,
                          "making_stage": _MAKING[st], "requests": [qc_request_json(r, user) for r in reqs]}))
    return out


# ---------- requisitions (BR-04) ----------
def requisition_block(item: m.OrderItem) -> str | None:
    open_store = [r.req_no for r in item.store_reqs if r.status not in ("Issued", "Partly Issued")]
    open_wood = [r.req_no for r in item.wood_reqs if r.status != "Completed"]
    if open_store or open_wood:
        return "Requisition " + ", ".join(open_store + open_wood)
    if not item.store_reqs and not item.wood_reqs and not item.no_req_remark:
        return "A requisition, or a 'No requisition needed' confirmation,"
    return None


# ---------- stage moves ----------
def allowed_moves(item: m.OrderItem, settings: dict) -> list[dict]:
    opt = settings.get("optional_stages", {})
    s = item.stage
    moves: list[dict] = []

    def add(to, label=None, block=None, style="primary"):
        moves.append(clean({"to": to, "label": label or to, "enabled": block is None,
                            "reason": f"{block} must be completed first." if block else None, "style": style}))

    if s == ASSIGNED:
        add(MACHINE, "Start Machine Room", requisition_block(item))
    elif s == MACHINE:
        add(SITE, "Move to Production Site")
    elif s == SITE:
        add(FORM_READY, "Form/Design Ready")
        if opt.get("machine_room_2", True) and item.machine_passes < 2:
            add(MACHINE2, "Machine Room again", style="secondary")
    elif s == MACHINE2:
        add(FORM_READY, "Form/Design Ready")
    elif s == FORM_READY:
        add(CARPENTER, "Assign to Carpenter")
    elif s == CARPENTER:
        add(CARPENTER_QC, "Send to Carpenter QC")
    elif s == CARPENTER_QC:
        add(LACQUER, "Move to Lacquer", None if qc_passed(item, CARPENTER_QC) else "Carpenter QC (both checks Pass)")
    elif s == LACQUER:
        add(LACQUER_QC, "Send to Lacquer QC")
    elif s == LACQUER_QC:
        block = None if qc_passed(item, LACQUER_QC) else "Lacquer QC (both checks Pass)"
        if item.upholstery_added:
            add(UPHOLSTERY, "Move to Upholstery", block)
        else:
            add(FINISH_GOOD, "Finish Good", block, "success")
            if opt.get("upholstery", True):
                add(UPHOLSTERY, "+ Upholstery", block, "secondary")
    elif s == UPHOLSTERY:
        add(UPHOLSTERY_QC, "Send to Upholstery QC")
    elif s == UPHOLSTERY_QC:
        add(FINISH_GOOD, "Finish Good", None if qc_passed(item, UPHOLSTERY_QC) else "Upholstery QC", "success")
    return moves


def _missing_step(item: m.OrderItem, to: str) -> str:
    if to == CARPENTER:
        return FORM_READY
    if to == MACHINE:
        return requisition_block(item) or "Site assignment"
    if to == LACQUER:
        return "Carpenter QC"
    if to in (FINISH_GOOD, UPHOLSTERY):
        return "Lacquer QC" if not item.upholstery_added or to == UPHOLSTERY else "Upholstery QC"
    idx = ALL_STAGES.index(to) if to in ALL_STAGES else 0
    return ALL_STAGES[max(0, idx - 1)]


def record_stage(db: DbSession, item: m.OrderItem, stage: str, user: m.User | None, note: str | None = None,
                 kind: str = "move", at: datetime | None = None):
    at = at or utcnow()
    if item.history and item.history[-1].ended_at is None:
        item.history[-1].ended_at = at
    h = m.StageHistory(item_id=item.id, stage=stage, kind=kind, started_at=at, user_id=user.id if user else None,
                       user_name=user.name if user else "System", note=note)
    item.history.append(h)
    item.stage = stage
    item.stage_since = at
    return h


def move_item(db: DbSession, item: m.OrderItem, to: str, user: m.User, settings: dict, note: str | None = None,
              final: dict | None = None, reviewer_id: int | None = None) -> list[str]:
    """Apply a stage move if the rules allow it. Returns warnings about missing report data (FR-PR-04)."""
    if item.order.state != "placed":
        raise HTTPException(409, "This order is not active, so its items cannot be moved.")
    move = next((mv for mv in allowed_moves(item, settings) if mv["to"] == to), None)
    if not move or not move["enabled"]:
        missing = (move or {}).get("reason", f"{_missing_step(item, to)} must be completed first.")
        raise HTTPException(409, f"This item cannot move to {to} yet. {missing}")
    warnings: list[str] = []
    ref = item_no(item)
    if to in (MACHINE, MACHINE2):
        item.machine_passes += 1
    if to == CARPENTER_QC:
        ensure_qc_report(db, item, settings)
    if to == UPHOLSTERY:
        item.upholstery_added = True
    if to == FINISH_GOOD:
        final = final or {}
        item.final_height = final.get("height") or item.height
        item.final_width = final.get("width") or item.width
        item.final_length = final.get("length") or item.length
        now = utcnow()
        item.finish_good_at = now
        record_stage(db, item, FINISH_GOOD, user, note, at=now)
        record_stage(db, item, IN_WAREHOUSE, user, "Moved to Product Warehouse", at=now)
        if not item.cost_sheet or not [l for l in item.cost_sheet.lines if not l.voided]:
            warnings.append("No production cost has been recorded for this item yet.")
        if item.qc and not item.qc.carpenter_side:
            warnings.append("Carpenter Working Side is not recorded on the QC report.")
        audit(db, user, "STAGE", "Item", ref, f"Marked Finish Good and moved to Product Warehouse")
        return warnings
    record_stage(db, item, to, user, note)
    audit(db, user, "STAGE", "Item", ref, f"Moved to {to}" + (f" - {note}" if note else ""))
    if to in QC_STAGES:
        submit_qc_request(db, item, to, user, settings, reviewer_id, note)
    return warnings


# ---------- serialisers ----------
def image_list(item: m.OrderItem) -> list[dict]:
    return [{"id": i.id, "file": i.filename, "name": i.original_name or i.filename} for i in item.images]


def item_brief(item: m.OrderItem, settings: dict) -> dict:
    o = item.order
    site = item.site
    return clean({
        "id": item.id, "item_no": item_no(item), "order_id": o.id, "order_no": o.order_no,
        "customer": o.customer.name, "customer_code": o.customer.code, "branch": o.branch.name,
        "sales_admin": o.sales_admin.name,
        "product_code": item.product_code, "product_name": item.product_name, "category": item.category,
        "amount": item.amount, "stage": item.stage, "status": item_status(item),
        "days_in_stage": days_in_stage(item) if item.stage not in (UNASSIGNED, DELIVERED) else None,
        "stage_since": iso(item.stage_since),
        "delayed": is_delayed(item, settings) or None, "rework": in_rework(item) or None,
        "rework_count": item.rework_count or None,
        "site_id": item.site_id, "site": site.code if site else None,
        "site_name": site.name if site else None,
        "apm": site.apm.name if site and site.apm else None,
        "apm_id": site.apm_id if site else None,
        "promised_date": iso(o.promised_date), "order_date": iso(o.placed_at or o.created_at),
        "upholstery_needed": item.upholstery_needed, "upholstery_added": item.upholstery_added,
        "image": item.images[0].filename if item.images else None,
        "colour": item.colour_name, "wood_category": item.wood_category,
        "finish_good_at": iso(item.finish_good_at), "packed_at": iso(item.packed_at),
        "ready_at": iso(item.ready_at), "delivered_at": iso(item.delivered_at),
        "delivery_date": iso(item.delivery_date), "delivered_by": item.delivered_by,
        "receiver_name": item.receiver_name,
        "qc_ref": item.qc.qc_ref if item.qc else None,
    })


def store_req_json(r: m.StoreRequisition) -> dict:
    it = r.item
    return clean({
        "id": r.id, "req_no": r.req_no, "status": r.status, "version": r.version,
        "return_reason": r.return_reason if r.status == "Returned" else None,
        "submitted_at": iso(r.submitted_at), "processed_at": iso(r.processed_at), "processed_by": r.processed_by,
        "apm": r.apm.name, "apm_id": r.apm_id, "item_id": it.id, "item_no": item_no(it),
        "order_no": it.order.order_no, "product_name": it.product_name, "product_code": it.product_code,
        "product_desc": it.product_desc, "site": it.site.code if it.site else None,
        "lines": [clean({"id": l.id, "material_code": l.material_code, "material_name": l.material_name,
                         "category": l.category, "details": l.details, "measurement": l.measurement,
                         "quantity": l.quantity, "issued_qty": l.issued_qty, "colour_code": l.colour_code,
                         "remarks": l.remarks}) for l in r.lines],
        "versions": r.versions or None,
    })


def wood_req_json(r: m.WoodRequisition) -> dict:
    it = r.item
    return clean({
        "id": r.id, "req_no": r.req_no, "status": r.status, "version": r.version,
        "return_reason": r.return_reason if r.status == "Returned" else None,
        "submitted_at": iso(r.submitted_at), "processed_at": iso(r.processed_at), "processed_by": r.processed_by,
        "apm": r.apm.name, "apm_id": r.apm_id, "item_id": it.id, "item_no": item_no(it),
        "order_no": it.order.order_no, "product_name": it.product_name,
        "site": it.site.code if it.site else None, "wood_category": r.wood_category,
        "seasoning": r.seasoning, "quantity": r.quantity, "measurement": r.measurement,
        "versions": r.versions or None,
    })


def qc_json(item: m.OrderItem, user: m.User | None = None) -> dict | None:
    q = item.qc
    if not q:
        return None
    o = item.order
    checks = {}
    for key, (label, stage, _making) in QC_CHECKS.items():
        if key == "upholstery" and not item.upholstery_added:
            continue
        rows = [clean({"id": r.id, "result": r.result, "checker": r.checker_name, "at": iso(r.at),
                       "note": r.note, "photo": r.photo}) for r in q.results if r.check == key]
        checks[key] = {"label": label, "stage": stage, "latest": rows[-1]["result"] if rows else None,
                       "history": rows,
                       "can_record": item.stage == stage and bool(user) and can_review_qc(user, item)}
    return clean({
        "qc_ref": q.qc_ref, "created_at": iso(q.created_at), "order_no": o.order_no, "item_no": item_no(item),
        "customer": o.customer.name, "product_name": item.product_name, "design": item.design_desc,
        "wood_category": item.wood_category, "seasoning": item.seasoning,
        "carpenter_side": q.carpenter_side, "remarks": q.remarks,
        "site": item.site.code if item.site else None,
        "apm": item.site.apm.name if item.site and item.site.apm else None,
        "upholstery": item.upholstery_added, "checks": checks, "rework_count": item.rework_count,
        "apm_signed_by": q.apm_signed_by, "apm_signed_at": iso(q.apm_signed_at),
        "pm_signed_by": q.pm_signed_by, "pm_signed_at": iso(q.pm_signed_at),
    })


def cost_json(item: m.OrderItem) -> dict:
    sheet = item.cost_sheet
    lines = sheet.lines if sheet else []
    return clean({
        "sheet_no": sheet.sheet_no if sheet else None,
        "total": round(sum(l.amount for l in lines if not l.voided), 2),
        "lines": [clean({"id": l.id, "name": l.name, "material_code": l.material_code, "rate": l.rate,
                         "per": l.per, "amount": l.amount, "entered_by": l.entered_by,
                         "entered_at": iso(l.entered_at), "voided": l.voided or None,
                         "void_reason": l.void_reason, "voided_by": l.voided_by,
                         "voided_at": iso(l.voided_at), "history": l.history or None}) for l in lines],
    })


def history_json(item: m.OrderItem) -> list[dict]:
    out = []
    for h in item.history:
        end = h.ended_at
        dur = round(((end or utcnow()) - h.started_at).total_seconds() / 3600, 1)
        out.append(clean({"stage": h.stage, "kind": h.kind, "started_at": iso(h.started_at),
                          "ended_at": iso(end), "hours": dur, "user": h.user_name, "note": h.note}))
    return out


def item_full(item: m.OrderItem, user: m.User, settings: dict) -> dict:
    d = item_brief(item, settings)
    d.update(clean({
        "product_desc": item.product_desc, "design_desc": item.design_desc,
        "height": item.height, "width": item.width, "length": item.length,
        "colour_code": item.colour_code, "colour_name": item.colour_name, "seasoning": item.seasoning,
        "final_height": item.final_height, "final_width": item.final_width, "final_length": item.final_length,
        "no_req_remark": item.no_req_remark, "machine_passes": item.machine_passes,
        "assigned_at": iso(item.assigned_at),
    }))
    d["images"] = image_list(item)
    d["history"] = history_json(item)
    d["order_status"] = order_status(item.order)
    if user.role != ROLE_SALES:
        d["store_requisitions"] = [store_req_json(r) for r in item.store_reqs]
        d["wood_requisitions"] = [wood_req_json(r) for r in item.wood_reqs]
        q = qc_json(item, user)
        if q:
            d["qc"] = q
        d["qc_tracker"] = qc_tracker(item, user)
    if user.role in (ROLE_APM, ROLE_SUPER):
        d["moves"] = allowed_moves(item, settings)
    if user.role != ROLE_SALES and item.stage != UNASSIGNED:
        d["report_data"] = report_readiness(item)
    if can_view_cost(user):
        d["cost"] = cost_json(item)
        d["can_edit_cost"] = has_cost_permission(user)
    current = next((r for r in item.reports if r.is_current), None)
    if current:
        d["report"] = {"id": current.id, "report_no": current.report_no, "status": current.status}
    return d


def order_json(order: m.Order, settings: dict, user: m.User | None = None, full: bool = False) -> dict:
    d = clean({
        "id": order.id, "order_no": order.order_no, "status": order_status(order), "state": order.state,
        "customer_id": order.customer_id, "customer": order.customer.name, "customer_code": order.customer.code,
        "customer_phone": order.customer.phone, "branch": order.branch.name, "branch_id": order.branch_id,
        "sales_admin": order.sales_admin.name, "order_date": iso(order.placed_at or order.created_at),
        "promised_date": iso(order.promised_date), "amount": round(sum(i.amount or 0 for i in order.items), 2),
        "item_count": len(order.items),
        "products": ", ".join(i.product_name for i in order.items if i.product_name),
        "categories": ", ".join(sorted({i.category for i in order.items if i.category})),
        "product_codes": ", ".join(i.product_code for i in order.items if i.product_code),
        "return_reason": order.return_reason if order.state == "returned" else None,
        "cancel_reason": order.cancel_reason,
        "editable": order.state in ("draft", "returned") or
                    (order.state == "placed" and all(i.stage == UNASSIGNED for i in order.items)),
    })
    if full and user:
        d["items"] = [item_full(i, user, settings) for i in order.items]
        d["customer_address"] = order.customer.address
    return d


# ---------- Production Report (Workflow I, FR-PR-01..05, BR-14) ----------
NOT_RECORDED = "Not recorded"


def build_report_data(item: m.OrderItem) -> tuple[dict, list[str]]:
    o = item.order
    missing: list[str] = []

    def need(v, label):
        if v in (None, "", []):
            missing.append(label)
            return NOT_RECORDED
        return v

    materials = []
    for r in item.store_reqs:
        for l in r.lines:
            qty = l.issued_qty if l.issued_qty is not None else (l.quantity if r.status == "Issued" else None)
            if qty:
                materials.append(clean({"material": l.material_name, "code": l.material_code,
                                        "details": l.details, "measurement": l.measurement, "qty": qty,
                                        "source": r.req_no}))
    for r in item.wood_reqs:
        if r.status == "Completed":
            materials.append({"material": f"Wood: {r.wood_category} ({r.seasoning})", "code": "Wood req.",
                              "measurement": r.measurement, "qty": r.quantity, "source": r.req_no})
    if not materials:
        missing.append("Materials used")

    stages = []
    for h in item.history:
        end = h.ended_at or h.started_at
        stages.append(clean({"stage": h.stage, "kind": h.kind, "start": iso(h.started_at), "end": iso(h.ended_at),
                             "hours": round((end - h.started_at).total_seconds() / 3600, 1),
                             "user": h.user_name, "note": h.note}))

    qc = None
    if item.qc:
        q = item.qc
        qc = clean({
            "qc_ref": q.qc_ref, "carpenter_side": need(q.carpenter_side, "Carpenter Working Side"),
            "remarks": q.remarks, "rework_count": item.rework_count,
            "checks": [{"label": QC_CHECKS[k][0],
                        "results": [clean({"result": r.result, "checker": r.checker_name, "at": iso(r.at),
                                           "note": r.note, "photo": r.photo})
                                    for r in q.results if r.check == k]}
                       for k in QC_CHECKS if any(r.check == k for r in q.results)],
            "apm_sign": need(q.apm_signed_by, "APM sign-off"), "apm_signed_at": iso(q.apm_signed_at),
            "pm_sign": need(q.pm_signed_by, "Production Manager sign-off"), "pm_signed_at": iso(q.pm_signed_at),
        })
    else:
        missing.append("Unified QC report")

    cost_lines = item.cost_sheet.lines if item.cost_sheet else []
    active = [l for l in cost_lines if not l.voided]
    if not active:
        missing.append("Production cost")
    cost = {
        "sheet_no": item.cost_sheet.sheet_no if item.cost_sheet else None,
        "lines": [clean({"name": l.name, "code": l.material_code, "rate": l.rate, "per": l.per,
                         "amount": l.amount, "entered_by": l.entered_by, "entered_at": iso(l.entered_at),
                         "voided": l.voided or None, "void_reason": l.void_reason}) for l in cost_lines],
        "total": round(sum(l.amount for l in active), 2),
    }

    lead_days = None
    if o.placed_at and item.delivered_at:
        lead_days = max(0, (item.delivered_at - o.placed_at).days)
    production_days = None
    if item.assigned_at and item.finish_good_at:
        production_days = max(0, (item.finish_good_at - item.assigned_at).days)

    data = {
        "header": clean({
            "order_no": o.order_no, "item_no": item_no(item), "customer": o.customer.name,
            "customer_code": o.customer.code, "sales_admin": o.sales_admin.name, "branch": o.branch.name,
            "site": item.site.code if item.site else NOT_RECORDED,
            "apm": item.site.apm.name if item.site and item.site.apm else NOT_RECORDED,
            "product_name": item.product_name, "product_code": item.product_code, "category": item.category,
            "order_date": iso(o.placed_at), "order_amount": item.amount,
        }),
        "product": clean({
            "product_desc": item.product_desc, "design_desc": item.design_desc,
            "ordered": {"height": item.height, "width": item.width, "length": item.length},
            "final": ({"height": item.final_height, "width": item.final_width, "length": item.final_length}
                      if item.final_height else need(None, "Final confirmed measurements")),
            "wood_requisition": [r.measurement for r in item.wood_reqs if r.status == "Completed"] or None,
            "colour": f"{item.colour_name} · {item.colour_code}", "wood": f"{item.wood_category} · {item.seasoning}",
            "upholstery": "Yes" if item.upholstery_added else "No",
            "images": [i.filename for i in item.images],
        }),
        "materials": materials,
        "no_requisition_remark": item.no_req_remark,
        "stages": stages,
        "lead_time_days": lead_days, "production_days": production_days,
        "qc": qc,
        "cost": cost,
        "delivery": {
            "finish_good": iso(item.finish_good_at), "packed": need(iso(item.packed_at), "Packed date"),
            "ready": need(iso(item.ready_at), "Ready for Delivery date"),
            "delivered": iso(item.delivered_at), "delivery_date": iso(item.delivery_date),
            "delivered_by": need(item.delivered_by, "Delivered by"),
            "receiver": need(item.receiver_name, "Receiver name"),
        },
        "missing": missing,
    }
    return data, missing


def report_readiness(item: m.OrderItem) -> list[dict]:
    """BRD 9.8: what each stage has recorded so far for the item's Production Report.

    status: done (recorded), missing (the stage has passed without it), waiting (the stage is still ahead).
    """
    stage = item.stage
    after_fg = stage in FINISHED or bool(item.finish_good_at)
    rows: list[dict] = []

    def row(key, label, who, status, detail=None):
        rows.append(clean({"key": key, "label": label, "who": who, "status": status, "detail": detail}))

    row("order", "Product specification, measurements and images", "Sales Admin · order placement",
        "done" if item.images and item.amount else "missing",
        f"{len(item.images)} image(s), ordered {item.height:g} x {item.width:g} x {item.length:g}" if item.height else None)

    issued = [r for r in item.store_reqs if r.status in ("Issued", "Partly Issued")]
    open_store = [r for r in item.store_reqs if r.status in ("Submitted", "Returned")]
    done_wood = [r for r in item.wood_reqs if r.status == "Completed"]
    open_wood = [r for r in item.wood_reqs if r.status in ("Submitted", "In Progress", "Returned")]
    if issued or done_wood:
        mat = ("done", ", ".join([r.req_no for r in issued + done_wood]))
    elif item.no_req_remark:
        mat = ("done", f"No requisition needed: {item.no_req_remark}")
    elif open_store or open_wood:
        mat = ("waiting", "Open: " + ", ".join(r.req_no for r in open_store + open_wood))
    else:
        mat = ("waiting" if stage in (UNASSIGNED, ASSIGNED) else "missing", None)
    row("materials", "Raw materials and wood used", "APM requests · Store Operator / Saw-Mill fulfil", *mat)

    n = len(item.history)
    row("stages", "Stage timeline (start, end, user, note)", "APM · every stage move",
        "done" if n else "waiting", f"{n} stage record(s)" if n else None)

    if not item.qc:
        row("qc", "Unified QC results and rework history", "QC reviewer · QC Requests",
            "missing" if after_fg else "waiting", "The QC report opens when the item reaches Carpenter QC.")
    else:
        required = [CARPENTER_QC, LACQUER_QC] + ([UPHOLSTERY_QC] if item.upholstery_added else [])
        passed = [s for s in required if qc_passed(item, s)]
        row("qc", "Unified QC results and rework history", "QC reviewer · QC Requests",
            "done" if len(passed) == len(required) else ("missing" if after_fg else "waiting"),
            f"{item.qc.qc_ref}: {len(passed)} of {len(required)} QC stage(s) passed"
            + (f", rework x {item.rework_count}" if item.rework_count else ""))
        row("qc_side", "Carpenter working side", "APM · QC report",
            "done" if item.qc.carpenter_side else ("missing" if after_fg else "waiting"), item.qc.carpenter_side)
        all_pass = len(passed) == len(required)
        for key, label, who, val in (("apm_sign", "APM sign-off", "APM · QC Requests, Sign-off", item.qc.apm_signed_by),
                                     ("pm_sign", "Production Manager sign-off", "Production Manager · QC Requests, Sign-off",
                                      item.qc.pm_signed_by)):
            row(key, label, who, "done" if val else ("missing" if after_fg and all_pass else "waiting"), val)

    row("final", "Final confirmed measurements", "APM · Finish Good",
        "done" if item.final_height else ("missing" if after_fg else "waiting"),
        f"{item.final_height:g} x {item.final_width:g} x {item.final_length:g}" if item.final_height else None)

    lines = [l for l in item.cost_sheet.lines if not l.voided] if item.cost_sheet else []
    row("cost", "Production cost lines", "Production Manager / cost-permitted users · Production Cost",
        "done" if lines else ("missing" if after_fg else "waiting"), f"{len(lines)} line(s)" if lines else None)

    for key, label, val in (("packed", "Packed date", item.packed_at), ("ready", "Ready for Delivery date", item.ready_at)):
        row(key, label, "Warehouse / Delivery · Warehouse List", "done" if val else "waiting",
            iso(val)[:10] if val else None)
    row("delivered", "Delivery date, delivered by and receiver", "Warehouse / Delivery · Warehouse List",
        "done" if item.delivered_at else "waiting",
        f"{item.delivered_by} to {item.receiver_name}" if item.delivered_at else
        "Marking the item Delivered generates the Production Report.")
    return rows


def generate_report(db: DbSession, item: m.OrderItem, user: m.User | None, settings: dict,
                    reason: str | None = None) -> m.ProductionReport:
    """One current report per item; any regeneration creates a new revision (BR-14)."""
    data, missing = build_report_data(item)
    existing = list(item.reports)
    now = utcnow()
    if existing:
        base = existing[0].base_no
        rev = max(r.revision for r in existing) + 1
        for r in existing:
            r.is_current = False
        report_no = f"{base}-R{rev}"
    else:
        base = next_number(db, item.order.org_id, "report", settings)
        rev = 0
        report_no = base
    status = "Incomplete" if missing else ("Revised" if rev else "Generated")
    rep = m.ProductionReport(org_id=item.order.org_id, item_id=item.id, report_no=report_no, base_no=base,
                             revision=rev, is_current=True, status=status, reason=reason, generated_at=now,
                             data=data)
    item.reports.append(rep)
    db.add(rep)
    audit(db, user, "REPORT", "Production Report", report_no,
          ("Revision created: " + reason) if rev else f"Generated automatically for {item_no(item)}",
          org_id=item.order.org_id)
    return rep


def report_json(rep: m.ProductionReport, user: m.User, with_data: bool = False) -> dict:
    h = rep.data.get("header", {})
    show_cost = can_view_cost(user)
    d = clean({
        "id": rep.id, "report_no": rep.report_no, "revision": rep.revision, "status": rep.status,
        "is_current": rep.is_current, "reason": rep.reason, "generated_at": iso(rep.generated_at),
        "item_id": rep.item_id, "order_no": h.get("order_no"), "item_no": h.get("item_no"),
        "customer": h.get("customer"), "product_name": h.get("product_name"),
        "product_code": h.get("product_code"), "category": h.get("category"), "site": h.get("site"),
        "apm": h.get("apm"), "branch": h.get("branch"),
        "delivery_date": rep.data.get("delivery", {}).get("delivery_date"),
        "lead_time_days": rep.data.get("lead_time_days"),
        "rework_count": (rep.data.get("qc") or {}).get("rework_count"),
        "total_cost": rep.data.get("cost", {}).get("total") if show_cost else None,
    })
    if with_data:
        data = dict(rep.data)
        if not show_cost:
            data.pop("cost", None)
            data["header"] = {k: v for k, v in data["header"].items() if k != "order_amount"} \
                if user.role == ROLE_APM else data["header"]
            data["missing"] = [x for x in data.get("missing", []) if x != "Production cost"]
        d["data"] = data
        d["show_cost"] = show_cost
    return d
