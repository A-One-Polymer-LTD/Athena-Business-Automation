"""Sign-in, reference data, files, customers and customer orders (Workflows A and B)."""
import secrets
from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session as DbSession, lazyload, selectinload

from .. import models as m
from .. import workflow as wf
from ..core import (LOCK_AFTER_FAILS, LOCK_MINUTES, ROLE_APM, ROLE_PM, ROLE_SALES, ROLE_STORE, ROLE_SAWMILL,
                    ROLE_SUPER, ROLE_WAREHOUSE, acting_sales_admin, audit, can_view_cost, clean, create_session,
                    current_user, deny,
                    get_settings, has_cost_permission, iso, next_number, parse_date, require, utcnow,
                    verify_password)
from ..database import get_db

router = APIRouter()

MAX_IMAGE = 5 * 1024 * 1024


def user_json(u: m.User) -> dict:
    return clean({"id": u.id, "login_id": u.login_id, "name": u.name, "role": u.role, "phone": u.phone,
                  "designation": u.designation, "branch_id": u.branch_id,
                  "branch": u.branch.name if u.branch else None, "active": u.active,
                  "cost_permission": has_cost_permission(u), "cost_granted": u.cost_permission,
                  "can_view_cost": can_view_cost(u)})


# ---------- authentication (FR-GEN-01) ----------
@router.post("/auth/login")
def login(body: dict = Body(...), db: DbSession = Depends(get_db)):
    login_id = (body.get("login_id") or "").strip().lower()
    password = body.get("password") or ""
    if not login_id or not password:
        raise HTTPException(422, "Please enter your user ID and password.")
    user = db.query(m.User).filter(m.User.login_id == login_id).first()
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        mins = int((user.locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(423, f"This account is locked after five failed sign-ins. Try again in {mins} minutes.")
    if not user or not verify_password(password, user.password_hash):
        if user:
            user.failed_logins += 1
            if user.failed_logins >= LOCK_AFTER_FAILS:
                user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                user.failed_logins = 0
                audit(db, user, "LOCKED", "User", user.login_id, "Account locked for 15 minutes after five failed sign-ins")
            db.commit()
        raise HTTPException(401, "The user ID or password is not correct.")
    if not user.active:
        raise HTTPException(403, "This account has been deactivated. Please contact the Super Admin.")
    user.failed_logins = 0
    user.locked_until = None
    token = create_session(db, user)
    audit(db, user, "LOGIN", "User", user.login_id, "Signed in")
    db.commit()
    return {"token": token, "user": user_json(user), "settings": get_settings(db, user.org_id)}


@router.post("/auth/logout")
def logout(user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    db.query(m.Session).filter_by(user_id=user.id).delete()
    audit(db, user, "LOGOUT", "User", user.login_id, "Signed out")
    db.commit()
    return {"ok": True}


@router.get("/auth/me")
def me(user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    return {"user": user_json(user), "settings": get_settings(db, user.org_id)}


@router.post("/auth/denied")
def denied(body: dict = Body(...), user: m.User = Depends(current_user)):
    """The web app reports screens it refused to open, so the attempt is in the audit log (TS-26)."""
    from ..core import log_denied
    log_denied(user, "screen", str(body.get("path") or "")[:60])
    return {"ok": True}


@router.get("/badges")
def badges(user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    """New-work counts shown on menu items (FR-GEN-05)."""
    out: dict[str, int] = {}
    org = user.org_id
    if user.role == ROLE_SUPER:
        out["store_inbox"] = db.query(m.StoreRequisition).filter_by(org_id=org, status="Submitted").count()
        out["wood_inbox"] = db.query(m.WoodRequisition).filter(
            m.WoodRequisition.org_id == org, m.WoodRequisition.status.in_(["Submitted", "In Progress"])).count()
        out["warehouse"] = (db.query(m.OrderItem).join(m.Order)
                            .filter(m.Order.org_id == org, m.OrderItem.stage == wf.IN_WAREHOUSE).count())
        out["returned_orders"] = db.query(m.Order).filter_by(org_id=org, state="returned").count()
        out["new_items"] = (db.query(m.OrderItem).join(m.Order)
                            .filter(m.Order.org_id == org, m.OrderItem.stage == wf.ASSIGNED).count())
        out["returned_store"] = db.query(m.StoreRequisition).filter_by(org_id=org, status="Returned").count()
        out["returned_wood"] = db.query(m.WoodRequisition).filter_by(org_id=org, status="Returned").count()
    if user.role in (ROLE_PM, ROLE_SUPER):
        # Pending (wf.order_status): placed, with no items or at least one item not yet assigned
        out["pending_orders"] = db.query(m.Order).filter(
            m.Order.org_id == org, m.Order.state == "placed",
            or_(~m.Order.items.any(), m.Order.items.any(m.OrderItem.stage == wf.UNASSIGNED))).count()
        out["signoff"] = (db.query(m.QCReport).join(m.OrderItem).join(m.Order)
                          .filter(m.Order.org_id == org, m.QCReport.pm_signed_by.is_(None),
                                  m.OrderItem.stage.in_(wf.FINISHED)).count())
    if user.role == ROLE_SALES:
        out["returned_orders"] = db.query(m.Order).filter_by(org_id=org, state="returned",
                                                             branch_id=user.branch_id).count()
    if user.role == ROLE_APM:
        sites = [s.id for s in db.query(m.Site).filter_by(org_id=org, apm_id=user.id)]
        out["new_items"] = db.query(m.OrderItem).filter(m.OrderItem.site_id.in_(sites),
                                                        m.OrderItem.stage == wf.ASSIGNED).count()
        out["returned_store"] = db.query(m.StoreRequisition).filter_by(apm_id=user.id, status="Returned").count()
        out["returned_wood"] = db.query(m.WoodRequisition).filter_by(apm_id=user.id, status="Returned").count()
    if user.role == ROLE_STORE:
        out["store_inbox"] = db.query(m.StoreRequisition).filter_by(org_id=org, status="Submitted").count()
    if user.role == ROLE_SAWMILL:
        out["wood_inbox"] = db.query(m.WoodRequisition).filter(
            m.WoodRequisition.org_id == org, m.WoodRequisition.status.in_(["Submitted", "In Progress"])).count()
    if user.role == ROLE_WAREHOUSE:
        out["warehouse"] = (db.query(m.OrderItem).join(m.Order)
                            .filter(m.Order.org_id == org, m.OrderItem.stage == wf.IN_WAREHOUSE).count())
    if user.role in (ROLE_SUPER, ROLE_PM, ROLE_APM):
        wf.sync_org_qc_requests(db, org, get_settings(db, org))
        # load only what wf.qc_todo reads: the item, its QC report and results
        qi = (db.query(m.OrderItem).join(m.Order).join(m.QCReport)
              .filter(m.Order.org_id == org, m.Order.state == "placed",
                      or_(m.OrderItem.stage.in_(wf.QC_STAGES), m.QCReport.apm_signed_by.is_(None),
                          m.QCReport.pm_signed_by.is_(None)))
              .options(lazyload("*"), selectinload(m.OrderItem.qc).selectinload(m.QCReport.results),
                       selectinload(m.OrderItem.qc_requests)))
        if user.role == ROLE_APM:
            qi = qi.filter(m.OrderItem.site_id.in_([s.id for s in db.query(m.Site).filter_by(org_id=org, apm_id=user.id)]))
        out["qc_input"] = sum(1 for it in qi if wf.qc_todo(it, user))
    return {k: v for k, v in out.items() if v}


@router.get("/meta")
def meta(user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Active master data for forms (BR-12: only active values can be selected)."""
    masters: dict[str, list] = {}
    for it in db.query(m.MasterItem).filter_by(org_id=user.org_id, active=True).order_by(m.MasterItem.name):
        masters.setdefault(it.kind, []).append(clean({"code": it.code, "name": it.name, "category": it.category,
                                                      "unit": it.unit}))
    sites = []
    open_counts: dict[int, int] = {}
    for sid, in db.query(m.OrderItem.site_id).filter(m.OrderItem.stage.in_(wf.PRODUCTION_STAGES)):
        open_counts[sid] = open_counts.get(sid, 0) + 1
    for s in db.query(m.Site).filter_by(org_id=user.org_id).order_by(m.Site.code):
        sites.append(clean({"id": s.id, "code": s.code, "name": s.name, "type": s.type, "active": s.active,
                            "apm_id": s.apm_id, "apm": s.apm.name if s.apm else None,
                            "open_items": open_counts.get(s.id, 0)}))
    branches = [{"id": b.id, "code": b.code, "name": b.name, "active": b.active}
                for b in db.query(m.Branch).filter_by(org_id=user.org_id).order_by(m.Branch.name)]
    return {"masters": masters, "sites": sites, "branches": branches, "stages": wf.ALL_STAGES,
            "production_stages": wf.PRODUCTION_STAGES, "lead_stages": wf.LEAD_STAGES}


# ---------- files (Section 8.8) ----------
def _sniff(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"%PDF"):
        return "pdf"
    return None


@router.post("/files")
async def upload(file: UploadFile = File(...), user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    data = await file.read()
    kind = _sniff(data[:16])
    name = file.filename or "file"
    if kind not in ("jpg", "png") or len(data) > MAX_IMAGE:
        raise HTTPException(422, f"{name} is not accepted. Use JPG or PNG up to 5 MB.")
    stored = f"{secrets.token_hex(12)}.{kind}"
    db.add(m.StoredFile(name=stored, content_type="image/png" if kind == "png" else "image/jpeg", data=data))
    db.commit()
    return {"file": stored, "name": name}


@router.get("/files/{name}")
def get_file(name: str, user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    f = db.get(m.StoredFile, name)
    if not f:
        raise HTTPException(404, "File not found.")
    return Response(content=f.data, media_type=f.content_type, headers={"Cache-Control": "private, max-age=86400"})


def file_exists(db: DbSession, name: str) -> bool:
    return bool(name) and db.query(m.StoredFile.name).filter_by(name=name).first() is not None


# ---------- customers ----------
def customer_json(c: m.Customer) -> dict:
    return clean({"id": c.id, "code": c.code, "name": c.name, "phone": c.phone, "address": c.address})


@router.get("/customers")
def customers(q: str = "", user: m.User = Depends(require(ROLE_SALES, ROLE_SUPER, ROLE_PM)),
              db: DbSession = Depends(get_db)):
    qry = db.query(m.Customer).filter_by(org_id=user.org_id)
    if q:
        like = f"%{q.strip()}%"
        qry = qry.filter(m.Customer.name.ilike(like) | m.Customer.phone.ilike(like) | m.Customer.code.ilike(like))
    return [customer_json(c) for c in qry.order_by(m.Customer.name).limit(25)]


def _find_or_create_customer(db: DbSession, user: m.User, body: dict, settings: dict, errors: dict) -> m.Customer | None:
    if body.get("customer_id"):
        c = db.get(m.Customer, int(body["customer_id"]))
        if not c or c.org_id != user.org_id:
            errors["customer"] = "Please select a customer from the list."
        return c
    new = body.get("customer") or {}
    name = (new.get("name") or "").strip()
    phone = "".join(ch for ch in (new.get("phone") or "") if ch.isdigit() or ch == "+")
    if not name:
        errors["customer"] = "Please enter Customer Name."
        return None
    if not 2 <= len(name) <= 100:
        errors["customer"] = "Customer Name must be 2 to 100 characters."
        return None
    if phone:
        if not 7 <= len(phone.lstrip("+")) <= 15:
            errors["customer_phone"] = "Please enter a valid mobile number."
            return None
        existing = db.query(m.Customer).filter_by(org_id=user.org_id, phone=phone).first()
        if existing and not body.get("use_new_customer"):
            raise HTTPException(409, {"code": "customer_exists", "customer": customer_json(existing),
                                      "message": f"A customer with this phone number already exists: "
                                                 f"{existing.name} ({existing.code}). Please use this customer."})
    c = m.Customer(org_id=user.org_id, code=next_number(db, user.org_id, "customer", settings), name=name,
                   phone=phone or None, address=(new.get("address") or "").strip()[:300] or None)
    db.add(c)
    db.flush()
    audit(db, user, "CREATE", "Customer", c.code, f"Customer {c.name} created")
    return c


# ---------- orders ----------
def _scope_orders(db: DbSession, user: m.User):
    q = db.query(m.Order).filter(m.Order.org_id == user.org_id)
    if user.role == ROLE_SALES:
        return q.filter(m.Order.branch_id == user.branch_id)
    if user.role == ROLE_SUPER:
        return q
    if user.role == ROLE_PM:
        return q.filter(m.Order.state != "draft")
    deny(user, "order records", message="Your role does not allow this action.")


def _get_order(db: DbSession, user: m.User, order_id: int) -> m.Order:
    o = db.get(m.Order, order_id)
    if not o or o.org_id != user.org_id:
        raise HTTPException(404, "Order not found.")
    if user.role == ROLE_SALES and o.branch_id != user.branch_id:
        deny(user, "order", o.order_no)
    if user.role == ROLE_PM and o.state == "draft":
        raise HTTPException(404, "Order not found.")
    if user.role not in (ROLE_SALES, ROLE_SUPER, ROLE_PM):
        deny(user, "order", o.order_no)
    return o


@router.get("/orders")
def list_orders(status: str = "", q: str = "", date_from: str = "", date_to: str = "", category: str = "",
                user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    settings = get_settings(db, user.org_id)
    rows = [wf.order_json(o, settings) for o in _scope_orders(db, user).order_by(m.Order.id.desc())]
    d1, d2 = parse_date(date_from), parse_date(date_to)
    out = []
    for r in rows:
        if status and r["status"] not in status.split(","):
            continue
        od = r["order_date"][:10]
        if d1 and od < d1.isoformat() or d2 and od > d2.isoformat():
            continue
        if category and category not in r.get("categories", ""):
            continue
        if q:
            hay = " ".join(str(r.get(k, "")) for k in ("order_no", "customer", "customer_code", "products",
                                                       "product_codes", "categories", "customer_phone")).lower()
            if q.lower() not in hay:
                continue
        out.append(r)
    return out


@router.get("/orders/{order_id}")
def order_detail(order_id: int, user: m.User = Depends(current_user), db: DbSession = Depends(get_db)):
    o = _get_order(db, user, order_id)
    d = wf.order_json(o, get_settings(db, user.org_id), user, full=True)
    if user.role == ROLE_SALES:
        # Sales Admins see the Production Report without the cost section (DEC-19)
        for it in d["items"]:
            it.pop("cost", None)
    return d


def _validate_items(db: DbSession, user: m.User, items: list, place: bool, errors: dict) -> list[dict]:
    masters = {(x.kind, x.code): x for x in db.query(m.MasterItem).filter_by(org_id=user.org_id, active=True)}
    woods = {x.name for x in masters.values() if x.kind == "wood"}
    seasonings = {x.name for x in masters.values() if x.kind == "seasoning"} or {"Seasonal", "Non-Seasonal"}
    out = []
    if not items:
        errors["items"] = "Please add at least one item."
    for idx, it in enumerate(items or []):
        p = f"items.{idx}."
        row: dict = {}
        code = str(it.get("product_code") or "").strip()
        prod = masters.get(("product", code))
        if code and not prod:
            errors[p + "product_code"] = f"Code {code} was not found. Please select a code from the list."
        elif not code and place:
            errors[p + "product_code"] = "Please enter Product Code."
        if prod:
            row.update(product_code=prod.code, product_name=prod.name, category=prod.category)
        for f, label in (("product_desc", "Product Description"), ("design_desc", "Design Description")):
            v = (it.get(f) or "").strip()
            if len(v) > 1000:
                errors[p + f] = f"{label} can be up to 1,000 characters."
            row[f] = v or None
        for f, label in (("height", "Height"), ("width", "Width"), ("length", "Length")):
            v = it.get(f)
            if v in (None, ""):
                if place:
                    errors[p + f] = f"Please enter {label}."
                row[f] = None
                continue
            try:
                n = float(v)
            except (TypeError, ValueError):
                errors[p + f] = f"{label} must be a number."
                continue
            if n <= 0:
                errors[p + f] = f"{label} must be greater than 0."
            row[f] = n
        ccode = str(it.get("colour_code") or "").strip()
        colour = masters.get(("colour", ccode))
        if ccode and not colour:
            errors[p + "colour_code"] = f"Code {ccode} was not found. Please select a code from the list."
        elif not ccode and place:
            errors[p + "colour_code"] = "Please enter Colour."
        if colour:
            row.update(colour_code=colour.code, colour_name=colour.name)
        wood = (it.get("wood_category") or "").strip()
        if wood and wood not in woods:
            errors[p + "wood_category"] = "Please select a Wood Category from the list."
        elif not wood and place:
            errors[p + "wood_category"] = "Please enter Wood Category."
        row["wood_category"] = wood or None
        seas = (it.get("seasoning") or "").strip()
        if seas and seas not in seasonings:
            errors[p + "seasoning"] = "Please select Wood Seasoning from the list."
        elif not seas and place:
            errors[p + "seasoning"] = "Please enter Wood Seasoning."
        row["seasoning"] = seas or None
        row["upholstery_needed"] = bool(it.get("upholstery_needed"))
        amt = it.get("amount")
        if amt in (None, ""):
            if place:
                errors[p + "amount"] = "Please enter Amount."
            row["amount"] = None
        else:
            try:
                a = round(float(amt), 2)
                if a <= 0:
                    errors[p + "amount"] = "Amount must be greater than 0."
                row["amount"] = a
            except (TypeError, ValueError):
                errors[p + "amount"] = "Amount must be a number."
        images = [str(x) for x in (it.get("images") or [])]
        if place and not images:
            errors[p + "images"] = "Please add at least one product image."
        if len(images) > 10:
            errors[p + "images"] = "Up to 10 images can be added per item."
        for f in images:
            if not file_exists(db, f):
                errors[p + "images"] = "An image could not be found. Please upload it again."
        row["images"] = images
        row["image_names"] = it.get("image_names") or {}
        out.append(row)
    return out


def _save_order(db: DbSession, user: m.User, body: dict, order: m.Order | None):
    settings = get_settings(db, user.org_id)
    place = bool(body.get("place"))
    errors: dict[str, str] = {}
    customer = _find_or_create_customer(db, user, body, settings, errors)
    rows = _validate_items(db, user, body.get("items") or [], place, errors)
    promised = None
    try:
        promised = parse_date(body.get("promised_date"))
    except HTTPException:
        errors["promised_date"] = "Please enter a valid Promised Delivery Date."
    if promised and promised < date.today() and (not order or order.promised_date != promised):
        errors["promised_date"] = "Promised Delivery Date must be on or after the order date."
    if errors:
        db.rollback()
        raise HTTPException(422, {"message": "Please correct the highlighted fields.", "fields": errors})

    # duplicate check (Section 9.6): same customer, product and measurements in the last 7 days
    if place and not body.get("confirm_duplicate"):
        since = utcnow() - timedelta(days=7)
        for r in rows:
            dup = (db.query(m.OrderItem).join(m.Order)
                   .filter(m.Order.customer_id == customer.id, m.Order.state == "placed",
                           m.Order.placed_at >= since, m.OrderItem.product_code == r["product_code"],
                           m.OrderItem.height == r["height"], m.OrderItem.width == r["width"],
                           m.OrderItem.length == r["length"])
                   .filter(m.Order.id != (order.id if order else 0)).first())
            if dup:
                db.rollback()
                raise HTTPException(409, {
                    "code": "duplicate", "order_no": dup.order.order_no, "date": iso(dup.order.placed_at),
                    "message": f"A similar order for this customer was placed on "
                               f"{dup.order.placed_at.strftime('%d-%b-%Y')} ({dup.order.order_no}). "
                               f"Place this order anyway?"})

    was_returned = bool(order and order.state == "returned")
    if not order:
        owner = acting_sales_admin(db, user, body)
        order = m.Order(org_id=user.org_id, branch_id=owner.branch_id, sales_admin_id=owner.id, state="draft",
                        lead_id=body.get("lead_id"))
        db.add(order)
    order.customer_id = customer.id
    order.customer = customer
    order.promised_date = promised
    # replace items (only possible before any item is assigned)
    order.items.clear()
    db.flush()
    for i, r in enumerate(rows, start=1):
        names = r.pop("image_names")
        images = r.pop("images")
        item = m.OrderItem(seq=i, stage=wf.UNASSIGNED, **r)
        item.images = [m.ItemImage(filename=f, original_name=names.get(f)) for f in images]
        order.items.append(item)
    if place:
        first_time = order.order_no is None
        if first_time:
            order.order_no = next_number(db, user.org_id, "order", settings)
        if order.state != "placed":
            order.placed_at = order.placed_at or utcnow()
        order.state = "placed"
        order.return_reason = None
        if body.get("confirm_duplicate"):
            audit(db, user, "WARNING", "Order", order.order_no, "Possible duplicate order confirmed by the Sales Admin")
        audit(db, user, "CREATE" if first_time else "UPDATE", "Order", order.order_no,
              "Order placed and sent to the Production Manager" if first_time else
              ("Order corrected and resubmitted" if was_returned else "Order updated"))
    else:
        if order.state == "placed":
            audit(db, user, "UPDATE", "Order", order.order_no, "Order updated")
        else:
            audit(db, user, "DRAFT", "Order", order.order_no or f"Draft #{order.id or 'new'}", "Draft saved")
    db.commit()
    msg = (f"Order {order.order_no} placed and sent to the Production Manager." if place else "Draft saved.")
    return {"id": order.id, "order_no": order.order_no, "status": wf.order_status(order), "message": msg}


@router.post("/orders")
def create_order(body: dict = Body(...), user: m.User = Depends(require(ROLE_SALES)),
                 db: DbSession = Depends(get_db)):
    return _save_order(db, user, body, None)


@router.put("/orders/{order_id}")
def update_order(order_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_SALES)),
                 db: DbSession = Depends(get_db)):
    o = _get_order(db, user, order_id)
    editable = o.state in ("draft", "returned") or (o.state == "placed" and all(i.stage == wf.UNASSIGNED for i in o.items))
    if not editable:
        raise HTTPException(409, "This order can no longer be edited because an item has been assigned to a site.")
    if o.state == "placed":
        body["place"] = True
    return _save_order(db, user, body, o)


@router.post("/orders/{order_id}/return")
def return_order(order_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_PM)),
                 db: DbSession = Depends(get_db)):
    o = _get_order(db, user, order_id)
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, "Please enter the reason for returning this order.")
    if o.state != "placed" or any(i.stage != wf.UNASSIGNED for i in o.items):
        raise HTTPException(409, "Only orders with no assigned items can be returned to the Sales Admin.")
    o.state = "returned"
    o.return_reason = reason
    audit(db, user, "RETURN", "Order", o.order_no, f"Returned to Sales Admin: {reason}")
    db.commit()
    return {"ok": True, "message": f"Order {o.order_no} returned to the Sales Admin."}


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, body: dict = Body(...), user: m.User = Depends(require(ROLE_SUPER)),
                 db: DbSession = Depends(get_db)):
    o = _get_order(db, user, order_id)
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, "Please enter the reason for cancelling this order.")
    if any(i.stage == wf.DELIVERED for i in o.items):
        raise HTTPException(409, "Delivered records are kept permanently and cannot be cancelled.")
    o.state = "cancelled"
    o.cancel_reason = reason
    audit(db, user, "CANCEL", "Order", o.order_no, f"Cancelled: {reason}")
    db.commit()
    return {"ok": True, "message": f"Order {o.order_no} cancelled."}
