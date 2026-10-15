"""Shared services: settings, authentication, RBAC, audit log, numbering and helpers."""
import copy
import secrets
from datetime import date, datetime, timedelta

import bcrypt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session as DbSession

from . import models as m
from .database import SessionLocal, get_db

ROLE_SUPER = "Super Admin"
ROLE_SALES = "Sales Admin"
ROLE_PM = "Production Manager"
ROLE_APM = "Assistant Production Manager"
ROLE_STORE = "Store Operator"
ROLE_SAWMILL = "Saw-Mill Supervisor"
ROLE_WAREHOUSE = "Warehouse / Delivery"
ROLES = [ROLE_SUPER, ROLE_SALES, ROLE_PM, ROLE_APM, ROLE_STORE, ROLE_SAWMILL, ROLE_WAREHOUSE]

SESSION_IDLE_MINUTES = 30
LOCK_AFTER_FAILS = 5
LOCK_MINUTES = 15

DEFAULT_SETTINGS = {
    "currency": "BDT",
    "currency_symbol": "৳",
    "number_format": "lakh",  # lakh | international
    "date_format": "DD-MMM-YYYY",
    "timezone": "Asia/Dhaka",
    "language": "English",
    "fiscal_year_start": 1,
    "measurement_unit": "in",
    "prefixes": {"order": "ATH", "customer": "CUS", "store_req": "SR", "wood_req": "WR", "qc": "QC",
                 "report": "PR", "cost": "PC", "sales_entry": "SE", "lead": "L", "qc_request": "QR"},
    "optional_stages": {"machine_room_2": True, "upholstery": True},
    "stage_limit_days": {"default": 5, "Assigned": 3, "Machine Room": 3, "Production Site": 5,
                         "Machine Room (2nd pass)": 3, "Form/Design Ready": 2, "Carpenter": 7,
                         "Carpenter QC": 2, "Lacquer": 5, "Lacquer QC": 2, "Upholstery": 5,
                         "Upholstery QC": 2},
    "weights": {"sales": 40, "collection": 25, "delivery": 20, "visits": 15},
    "thresholds": {"on_track": 75, "watch": 50},
}

_NUMBER_WIDTH = {"order": 6, "customer": 6, "store_req": 5, "wood_req": 5, "qc": 6, "report": 6, "cost": 6,
                 "sales_entry": 6, "lead": 5, "qc_request": 6}


def utcnow() -> datetime:
    return datetime.utcnow()


def iso(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds") + "Z"
    return v.isoformat()


def parse_date(v, field="Date") -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        raise HTTPException(422, f"Please enter a valid {field}.")


def get_settings(db: DbSession, org_id: int) -> dict:
    org = db.get(m.Organisation, org_id)
    s = copy.deepcopy(DEFAULT_SETTINGS)
    for k, v in (org.settings or {}).items():
        if isinstance(v, dict) and isinstance(s.get(k), dict):
            s[k].update(v)
        else:
            s[k] = v
    s["organisation"] = org.name
    return s


# ---------- passwords and sessions ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def create_session(db: DbSession, user: m.User) -> str:
    sid = secrets.token_urlsafe(40)
    db.add(m.Session(id=sid, user_id=user.id))
    return sid


def current_user(authorization: str | None = Header(default=None), db: DbSession = Depends(get_db)) -> m.User:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Please sign in.")
    sess = db.get(m.Session, token)
    if not sess:
        raise HTTPException(401, "Your session has ended. Please sign in again.")
    now = utcnow()
    if now - sess.last_activity > timedelta(minutes=SESSION_IDLE_MINUTES):
        db.delete(sess)
        db.commit()
        raise HTTPException(401, "Your session ended after 30 minutes without activity. Please sign in again.")
    user = db.get(m.User, sess.user_id)
    if not user or not user.active:
        db.delete(sess)
        db.commit()
        raise HTTPException(401, "This account is no longer active.")
    if (now - sess.last_activity).total_seconds() > 60:
        sess.last_activity = now
        db.commit()
    return user


def log_denied(user: m.User, what: str, ref: str | None = None):
    """Refused requests are logged even though the request itself fails (TS-16, TS-26)."""
    with SessionLocal() as s:
        s.add(m.AuditLog(org_id=user.org_id, user_id=user.id, user_name=user.name, role=user.role,
                         action="ACCESS_DENIED", entity=what, ref=ref,
                         detail=f"{user.role} {user.login_id} was refused access to {what}"
                                + (f" {ref}" if ref else "")))
        s.commit()


def deny(user: m.User, what: str, ref: str | None = None, message: str | None = None):
    log_denied(user, what, ref)
    raise HTTPException(403, message or "You do not have access to this record.")


def require(*roles: str):
    """Allow the given roles. The Super Admin has full access to every function."""
    def dep(user: m.User = Depends(current_user)) -> m.User:
        if user.role not in roles and user.role != ROLE_SUPER:
            deny(user, "a restricted function", message="Your role does not allow this action.")
        return user
    return dep


def has_cost_permission(user: m.User) -> bool:
    """Enter/edit cost lines: Production Manager by default, plus users the Super Admin grants."""
    return user.role in (ROLE_PM, ROLE_SUPER) or bool(user.cost_permission)


def can_view_cost(user: m.User) -> bool:
    return user.role == ROLE_SUPER or has_cost_permission(user)


def acting_sales_admin(db: DbSession, user: m.User, body: dict) -> m.User:
    """The Sales Admin a sales record belongs to: the user, or the one the Super Admin chose."""
    if user.role == ROLE_SALES:
        return user
    if user.role != ROLE_SUPER:
        deny(user, "sales records", message="Your role does not allow this action.")
    sa = db.get(m.User, int(body.get("sales_admin_id") or 0))
    if not sa or sa.org_id != user.org_id or sa.role != ROLE_SALES or not sa.active:
        raise HTTPException(422, "Please choose the Sales Admin this record is for.")
    return sa


# ---------- audit and numbering ----------
def audit(db: DbSession, user: m.User | None, action: str, entity: str, ref: str | None = None,
          detail: str | None = None, org_id: int | None = None):
    db.add(m.AuditLog(org_id=org_id or (user.org_id if user else 0), user_id=user.id if user else None,
                      user_name=user.name if user else "System", role=user.role if user else None,
                      action=action, entity=entity, ref=ref, detail=detail))


def next_number(db: DbSession, org_id: int, key: str, settings: dict | None = None, year: int | None = None) -> str:
    settings = settings or get_settings(db, org_id)
    yearly = key != "customer"
    y = (year or utcnow().year) if yearly else 0
    c = db.query(m.Counter).filter_by(org_id=org_id, key=key, year=y).with_for_update().first()
    if not c:
        c = m.Counter(org_id=org_id, key=key, year=y, value=0)
        db.add(c)
    c.value += 1
    db.flush()
    prefix = settings["prefixes"].get(key, key.upper())
    num = str(c.value).zfill(_NUMBER_WIDTH[key])
    return f"{prefix}-{y}-{num}" if yearly else f"{prefix}-{num}"


def clean(d: dict) -> dict:
    """Drop empty values so that screens never receive null fields (FR-GEN-04)."""
    return {k: v for k, v in d.items() if v is not None and v != ""}


def req_text(v, field: str, lo: int = 1, hi: int = 300, required: bool = True) -> str | None:
    v = (v or "").strip() if isinstance(v, str) else v
    if not v:
        if required:
            raise HTTPException(422, f"Please enter {field}.")
        return None
    if len(v) < lo or len(v) > hi:
        raise HTTPException(422, f"{field} must be {lo} to {hi} characters.")
    return v


def req_number(v, field: str, gt: float | None = None, ge: float | None = None, required: bool = True):
    if v in (None, ""):
        if required:
            raise HTTPException(422, f"Please enter {field}.")
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise HTTPException(422, f"{field} must be a number.")
    if gt is not None and not n > gt:
        raise HTTPException(422, f"{field} must be greater than {gt:g}.")
    if ge is not None and n < ge:
        raise HTTPException(422, f"{field} must be {ge:g} or more.")
    return round(n, 2)
