"""Data model (BRD Section 9.1). Every top-level entity carries an organisation ID."""
from datetime import date, datetime

from sqlalchemy import (JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def now():
    return datetime.utcnow()


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class Branch(Base):
    __tablename__ = "branches"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"), index=True)
    login_id: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(30))
    designation: Mapped[str | None] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(30), index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"))
    cost_permission: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    branch: Mapped["Branch"] = relationship(lazy="selectin")


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_activity: Mapped[datetime] = mapped_column(DateTime, default=now)


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(20), default="In-house")  # In-house | Contract
    apm_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    apm: Mapped["User"] = relationship(lazy="selectin")


class MasterItem(Base):
    """Master lists: product_category, product, material_category, material, wood, seasoning, colour."""
    __tablename__ = "master_items"
    __table_args__ = (UniqueConstraint("org_id", "kind", "code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    code: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str | None] = mapped_column(String(150))  # category name for products/materials
    unit: Mapped[str | None] = mapped_column(String(30))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Counter(Base):
    __tablename__ = "counters"
    __table_args__ = (UniqueConstraint("org_id", "key", "year"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer)
    key: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(Integer)
    value: Mapped[int] = mapped_column(Integer, default=0)


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"), index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(30), index=True)
    address: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"), index=True)
    order_no: Mapped[str | None] = mapped_column(String(30), unique=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"), index=True)
    sales_admin_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    state: Mapped[str] = mapped_column(String(20), default="draft")  # draft|placed|returned|cancelled
    return_reason: Mapped[str | None] = mapped_column(Text)
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    promised_date: Mapped[date | None] = mapped_column(Date)
    lead_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    placed_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    customer: Mapped["Customer"] = relationship(lazy="selectin")
    branch: Mapped["Branch"] = relationship(lazy="selectin")
    sales_admin: Mapped["User"] = relationship(lazy="selectin")
    items: Mapped[list["OrderItem"]] = relationship(lazy="selectin", back_populates="order", order_by="OrderItem.seq",
                                                    cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer, default=1)
    product_code: Mapped[str | None] = mapped_column(String(30))
    product_name: Mapped[str | None] = mapped_column(String(150))
    category: Mapped[str | None] = mapped_column(String(150))
    product_desc: Mapped[str | None] = mapped_column(Text)
    design_desc: Mapped[str | None] = mapped_column(Text)
    height: Mapped[float | None] = mapped_column(Float)
    width: Mapped[float | None] = mapped_column(Float)
    length: Mapped[float | None] = mapped_column(Float)
    colour_code: Mapped[str | None] = mapped_column(String(30))
    colour_name: Mapped[str | None] = mapped_column(String(100))
    wood_category: Mapped[str | None] = mapped_column(String(100))
    seasoning: Mapped[str | None] = mapped_column(String(50))
    upholstery_needed: Mapped[bool] = mapped_column(Boolean, default=False)
    amount: Mapped[float | None] = mapped_column(Float)
    # production
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id"), index=True)
    stage: Mapped[str] = mapped_column(String(40), default="Unassigned", index=True)
    stage_since: Mapped[datetime | None] = mapped_column(DateTime)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime)
    machine_passes: Mapped[int] = mapped_column(Integer, default=0)
    upholstery_added: Mapped[bool] = mapped_column(Boolean, default=False)
    no_req_remark: Mapped[str | None] = mapped_column(Text)
    rework_count: Mapped[int] = mapped_column(Integer, default=0)
    final_height: Mapped[float | None] = mapped_column(Float)
    final_width: Mapped[float | None] = mapped_column(Float)
    final_length: Mapped[float | None] = mapped_column(Float)
    finish_good_at: Mapped[datetime | None] = mapped_column(DateTime)
    packed_at: Mapped[datetime | None] = mapped_column(DateTime)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime)
    delivery_date: Mapped[date | None] = mapped_column(Date)
    delivered_by: Mapped[str | None] = mapped_column(String(100))
    receiver_name: Mapped[str | None] = mapped_column(String(100))
    order: Mapped["Order"] = relationship(lazy="selectin", back_populates="items")
    site: Mapped["Site"] = relationship(lazy="selectin")
    images: Mapped[list["ItemImage"]] = relationship(lazy="selectin",
                                                     cascade="all, delete-orphan", order_by="ItemImage.id")
    history: Mapped[list["StageHistory"]] = relationship(lazy="selectin",
                                                         order_by="StageHistory.id", cascade="all, delete-orphan")
    store_reqs: Mapped[list["StoreRequisition"]] = relationship(lazy="selectin", order_by="StoreRequisition.id",
                                                                back_populates="item")
    wood_reqs: Mapped[list["WoodRequisition"]] = relationship(lazy="selectin", order_by="WoodRequisition.id",
                                                              back_populates="item")
    qc: Mapped["QCReport"] = relationship(lazy="selectin", uselist=False, back_populates="item")
    cost_sheet: Mapped["CostSheet"] = relationship(lazy="selectin", uselist=False, back_populates="item")
    reports: Mapped[list["ProductionReport"]] = relationship(order_by="ProductionReport.revision",
                                                             back_populates="item")
    qc_requests: Mapped[list["QCRequest"]] = relationship(lazy="selectin", order_by="QCRequest.id",
                                                           back_populates="item")


class ItemImage(Base):
    __tablename__ = "item_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    filename: Mapped[str] = mapped_column(String(120))
    original_name: Mapped[str | None] = mapped_column(String(200))


class StageHistory(Base):
    __tablename__ = "stage_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    stage: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(20), default="move")  # move|rework|reversal|reassign|undo
    started_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    user_name: Mapped[str | None] = mapped_column(String(100))
    note: Mapped[str | None] = mapped_column(Text)


class StoreRequisition(Base):
    __tablename__ = "store_requisitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    req_no: Mapped[str] = mapped_column(String(30), unique=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    apm_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="Submitted")  # Submitted|Issued|Partly Issued|Returned
    version: Mapped[int] = mapped_column(Integer, default=1)
    return_reason: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime)
    processed_by: Mapped[str | None] = mapped_column(String(100))
    versions: Mapped[list] = mapped_column(JSON, default=list)  # history of earlier versions
    apm: Mapped["User"] = relationship(lazy="selectin")
    item: Mapped["OrderItem"] = relationship(lazy="selectin", back_populates="store_reqs")
    lines: Mapped[list["StoreReqLine"]] = relationship(lazy="selectin",
                                                       cascade="all, delete-orphan", order_by="StoreReqLine.id")


class StoreReqLine(Base):
    __tablename__ = "store_req_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    req_id: Mapped[int] = mapped_column(ForeignKey("store_requisitions.id"), index=True)
    material_code: Mapped[str] = mapped_column(String(30))
    material_name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str | None] = mapped_column(String(150))
    details: Mapped[str | None] = mapped_column(String(300))
    measurement: Mapped[str | None] = mapped_column(String(100))
    quantity: Mapped[float] = mapped_column(Float)
    issued_qty: Mapped[float | None] = mapped_column(Float)
    colour_code: Mapped[str | None] = mapped_column(String(30))
    remarks: Mapped[str | None] = mapped_column(String(300))


class WoodRequisition(Base):
    __tablename__ = "wood_requisitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    req_no: Mapped[str] = mapped_column(String(30), unique=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    apm_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    wood_category: Mapped[str] = mapped_column(String(100))
    seasoning: Mapped[str] = mapped_column(String(50))
    quantity: Mapped[float] = mapped_column(Float)
    measurement: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="Submitted")  # Submitted|In Progress|Completed|Returned
    version: Mapped[int] = mapped_column(Integer, default=1)
    return_reason: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime)
    processed_by: Mapped[str | None] = mapped_column(String(100))
    versions: Mapped[list] = mapped_column(JSON, default=list)
    apm: Mapped["User"] = relationship(lazy="selectin")
    item: Mapped["OrderItem"] = relationship(lazy="selectin", back_populates="wood_reqs")


class QCReport(Base):
    __tablename__ = "qc_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), unique=True)
    qc_ref: Mapped[str] = mapped_column(String(30), unique=True)
    carpenter_side: Mapped[str | None] = mapped_column(String(150))
    remarks: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    apm_signed_by: Mapped[str | None] = mapped_column(String(100))
    apm_signed_at: Mapped[datetime | None] = mapped_column(DateTime)
    pm_signed_by: Mapped[str | None] = mapped_column(String(100))
    pm_signed_at: Mapped[datetime | None] = mapped_column(DateTime)
    item: Mapped["OrderItem"] = relationship(lazy="selectin", back_populates="qc")
    results: Mapped[list["QCResult"]] = relationship(lazy="selectin",
                                                     cascade="all, delete-orphan", order_by="QCResult.id")


class QCResult(Base):
    __tablename__ = "qc_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("qc_reports.id"), index=True)
    check: Mapped[str] = mapped_column(String(30))  # carp_before|carp_final|lacq_before|lacq_final|upholstery
    result: Mapped[str] = mapped_column(String(10))  # Pass|Rework
    checker_name: Mapped[str] = mapped_column(String(100))
    checker_id: Mapped[int | None] = mapped_column(Integer)
    at: Mapped[datetime] = mapped_column(DateTime, default=now)
    note: Mapped[str | None] = mapped_column(Text)
    photo: Mapped[str | None] = mapped_column(String(120))


class QCRequest(Base):
    """One request to review a QC stage (Carpenter, Lacquer or Upholstery QC) of an item, sent to a named reviewer.

    Pending until the reviewer approves (every check of the stage Pass) or rejects (Rework, back to the making
    stage). A rejected item that is sent to the same QC stage again gets a new request with the next round.
    """
    __tablename__ = "qc_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    request_no: Mapped[str] = mapped_column(String(30), unique=True)
    stage: Mapped[str] = mapped_column(String(30))  # Carpenter QC | Lacquer QC | Upholstery QC
    round: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="Pending", index=True)  # Pending|Approved|Rejected|Withdrawn
    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    submitted_by: Mapped[str] = mapped_column(String(100))
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    note: Mapped[str | None] = mapped_column(Text)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    reviewer: Mapped[str] = mapped_column(String(100))
    decided_by: Mapped[str | None] = mapped_column(String(100))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    feedback: Mapped[str | None] = mapped_column(Text)
    results: Mapped[list] = mapped_column(JSON, default=list)  # check results recorded for this request
    reassignments: Mapped[list] = mapped_column(JSON, default=list)
    item: Mapped["OrderItem"] = relationship(back_populates="qc_requests")


class CostSheet(Base):
    __tablename__ = "cost_sheets"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), unique=True)
    sheet_no: Mapped[str] = mapped_column(String(30), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    item: Mapped["OrderItem"] = relationship(lazy="selectin", back_populates="cost_sheet")
    lines: Mapped[list["CostLine"]] = relationship(lazy="selectin",
                                                   cascade="all, delete-orphan", order_by="CostLine.id")


class CostLine(Base):
    __tablename__ = "cost_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("cost_sheets.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    material_code: Mapped[str | None] = mapped_column(String(30))
    rate: Mapped[float] = mapped_column(Float)
    per: Mapped[str] = mapped_column(String(10))
    amount: Mapped[float] = mapped_column(Float)
    entered_by: Mapped[str] = mapped_column(String(100))
    entered_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    voided: Mapped[bool] = mapped_column(Boolean, default=False)
    void_reason: Mapped[str | None] = mapped_column(Text)
    voided_by: Mapped[str | None] = mapped_column(String(100))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime)
    history: Mapped[list] = mapped_column(JSON, default=list)  # earlier values after corrections


class ProductionReport(Base):
    __tablename__ = "production_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    report_no: Mapped[str] = mapped_column(String(40), unique=True)
    base_no: Mapped[str] = mapped_column(String(30))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="Generated")  # Generated|Revised|Incomplete
    reason: Mapped[str | None] = mapped_column(Text)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    item: Mapped["OrderItem"] = relationship(back_populates="reports")


class SalesEntry(Base):
    __tablename__ = "sales_entries"
    __table_args__ = (UniqueConstraint("sales_admin_id", "entry_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    entry_no: Mapped[str] = mapped_column(String(30), unique=True)
    sales_admin_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"))
    entry_date: Mapped[date] = mapped_column(Date, index=True)
    sales: Mapped[float] = mapped_column(Float, default=0)
    collection: Mapped[float] = mapped_column(Float, default=0)
    delivery: Mapped[float] = mapped_column(Float, default=0)
    visits: Mapped[int] = mapped_column(Integer, default=0)
    remarks: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)


class Lead(Base):
    __tablename__ = "leads"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    lead_no: Mapped[str] = mapped_column(String(30), unique=True)
    sales_admin_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"))
    lead_date: Mapped[date] = mapped_column(Date, index=True)
    customer_name: Mapped[str] = mapped_column(String(100))
    customer_phone: Mapped[str | None] = mapped_column(String(30))
    expected_value: Mapped[float] = mapped_column(Float, default=0)
    stage: Mapped[str] = mapped_column(String(30), default="New")
    status: Mapped[str] = mapped_column(String(20), default="Open")
    lost_reason: Mapped[str | None] = mapped_column(Text)
    next_followup: Mapped[date | None] = mapped_column(Date)
    remarks: Mapped[str | None] = mapped_column(String(500))
    closed_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SalesTarget(Base):
    __tablename__ = "sales_targets"
    __table_args__ = (UniqueConstraint("sales_admin_id", "year", "month"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    sales_admin_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    sales: Mapped[float] = mapped_column(Float, default=0)
    collection: Mapped[float] = mapped_column(Float, default=0)
    delivery: Mapped[float] = mapped_column(Float, default=0)
    visits: Mapped[float] = mapped_column(Float, default=0)
    leads: Mapped[float] = mapped_column(Float, default=0)
    orders: Mapped[float] = mapped_column(Float, default=0)


class PeriodLock(Base):
    __tablename__ = "period_locks"
    __table_args__ = (UniqueConstraint("org_id", "year", "month"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    locked_by: Mapped[str] = mapped_column(String(100))
    locked_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class StoredFile(Base):
    """Uploaded images (product photos, QC photos). Kept in the database and served only to signed-in users."""
    __tablename__ = "stored_files"
    name: Mapped[str] = mapped_column(String(120), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(40))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    user_name: Mapped[str | None] = mapped_column(String(100))
    role: Mapped[str | None] = mapped_column(String(30))
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity: Mapped[str] = mapped_column(String(40))
    ref: Mapped[str | None] = mapped_column(String(60))
    detail: Mapped[str | None] = mapped_column(Text)
