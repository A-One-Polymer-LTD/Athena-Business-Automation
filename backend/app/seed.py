"""Sample data for the prototype (BRD Section 10.6).

Seven sites, about 30 orders across every stage, rework history, items with and without upholstery,
demo users for each role, three branches with eight Sales Admins, twelve months of sales entries,
targets and about 100 leads, cost lines and Production Reports for delivered items.
"""
import calendar
import random
import struct
import zlib
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session as DbSession

from . import models as m
from . import workflow as wf
from .core import (DEFAULT_SETTINGS, ROLE_APM, ROLE_PM, ROLE_SALES, ROLE_SAWMILL, ROLE_STORE, ROLE_SUPER,
                   ROLE_WAREHOUSE, get_settings, hash_password)
from .database import UPLOAD_DIR

DEMO_PASSWORD = "Athena@123"

PRODUCT_CATEGORIES = [("10", "Sofa"), ("11", "Bed"), ("12", "Dining"), ("13", "Table"), ("14", "Chair"),
                      ("15", "Wardrobe & Storage"), ("16", "Office")]
PRODUCTS = [
    ("100001", "3-Seat Sofa", "Sofa", 185000), ("100002", "L-Shape Corner Sofa", "Sofa", 265000),
    ("100003", "2-Seat Loveseat", "Sofa", 120000), ("100045", "Classic Sofa Set (3+1+1)", "Sofa", 320000),
    ("110001", "King Bed with Headboard", "Bed", 210000), ("110002", "Queen Bed", "Bed", 165000),
    ("110003", "Single Bed", "Bed", 78000), ("120001", "6-Seat Dining Table", "Dining", 145000),
    ("120002", "8-Seat Dining Table", "Dining", 198000), ("120003", "Dining Chair", "Dining", 18500),
    ("130001", "Centre Table", "Table", 42000), ("130002", "Console Table", "Table", 56000),
    ("130003", "Bedside Table", "Table", 24000), ("140001", "Accent Armchair", "Chair", 64000),
    ("140002", "Rocking Chair", "Chair", 48000), ("150001", "3-Door Wardrobe", "Wardrobe & Storage", 175000),
    ("150002", "Bookshelf", "Wardrobe & Storage", 72000), ("150003", "TV Cabinet", "Wardrobe & Storage", 88000),
    ("160001", "Executive Desk", "Office", 132000), ("160002", "Conference Table", "Office", 240000),
]
MATERIAL_CATEGORIES = [("301", "Timber & Board"), ("302", "Foam & Fabric"), ("303", "Hardware"),
                       ("304", "Chemicals & Finish"), ("305", "Adhesives & Abrasives")]
MATERIALS = [
    ("3010012", "Mahogany Timber", "Timber & Board", "cft", 2800), ("3010013", "Teak (Segun) Timber", "Timber & Board", "cft", 5200),
    ("3010020", "Plywood 18 mm", "Timber & Board", "sheet", 3400), ("3010021", "MDF Board 12 mm", "Timber & Board", "sheet", 2100),
    ("3010030", "Veneer Sheet", "Timber & Board", "sheet", 950),
    ("3020004", "Foam Sheet 40D", "Foam & Fabric", "pcs", 1850), ("3020005", "Foam Sheet 32D", "Foam & Fabric", "pcs", 1400),
    ("3020010", "Upholstery Fabric - Velvet", "Foam & Fabric", "yard", 780), ("3020011", "Upholstery Fabric - Linen", "Foam & Fabric", "yard", 640),
    ("3020015", "Artificial Leather", "Foam & Fabric", "yard", 920), ("3020020", "Webbing Belt", "Foam & Fabric", "roll", 450),
    ("3030001", "Drawer Channel 18 in", "Hardware", "pair", 520), ("3030002", "Soft-Close Hinge", "Hardware", "pcs", 180),
    ("3030005", "Wood Screw 1.5 in", "Hardware", "box", 240), ("3030008", "Cabinet Handle", "Hardware", "pcs", 160),
    ("3030010", "Bed Fitting Bracket", "Hardware", "set", 680), ("3030012", "Sofa Leg (Wooden)", "Hardware", "pcs", 220),
    ("3040001", "NC Lacquer Clear", "Chemicals & Finish", "litre", 620), ("3040002", "Wood Stain - Walnut", "Chemicals & Finish", "litre", 540),
    ("3040003", "Sanding Sealer", "Chemicals & Finish", "litre", 480), ("3040005", "Thinner", "Chemicals & Finish", "litre", 210),
    ("3040008", "PU Top Coat", "Chemicals & Finish", "litre", 980),
    ("3050001", "Wood Adhesive", "Adhesives & Abrasives", "kg", 320), ("3050002", "Contact Adhesive", "Adhesives & Abrasives", "litre", 410),
    ("3050005", "Sandpaper 120 Grit", "Adhesives & Abrasives", "sheet", 28), ("3050006", "Sandpaper 240 Grit", "Adhesives & Abrasives", "sheet", 32),
]
WOODS = ["Teak (Segun)", "Mahogany", "Gamari", "Oak", "Beech"]
COLOURS = [("CL-201", "Natural Teak"), ("CL-204", "Honey Oak"), ("CL-208", "Walnut"), ("CL-212", "Dark Mahogany"),
           ("CL-215", "Espresso"), ("CL-220", "Antique White"), ("CL-224", "Charcoal Grey"), ("CL-230", "Natural Matt")]
CUSTOMERS = ["Farhana Rahman", "Imran Chowdhury", "Nusrat Jahan", "Tanvir Ahmed", "Sharmin Akter", "Mahbub Alam",
             "Rumana Islam", "Kamrul Hasan", "Sadia Sultana", "Arif Hossain", "Tasnim Haque", "Zahid Karim",
             "Lamia Siddique", "Rakib Uddin", "Mehnaz Kabir", "Shafiq Mollah", "Nadia Parvin", "Asif Mahmud",
             "Roksana Begum", "Jubayer Khan", "Meridian Hotels Ltd.", "Greenleaf Residences", "Orbit Corporate Office",
             "Tahmina Yasmin"]
DELIVERY_STAFF = ["Jahangir Alam", "Sumon Mia", "Rubel Hossain"]
CARPENTER_TEAMS = ["Team A - Karim", "Team B - Salam", "Team C - Nurul", "Team D - Babul"]

SHAPES = {  # simple product silhouettes: (x0, y0, x1, y1, tone)
    "Sofa": [(.12, .42, .88, .72, 0), (.12, .30, .88, .46, 1), (.06, .40, .16, .76, 1), (.84, .40, .94, .76, 1),
             (.16, .76, .20, .84, 2), (.80, .76, .84, .84, 2)],
    "Bed": [(.10, .50, .90, .70, 0), (.10, .22, .18, .76, 1), (.86, .42, .92, .76, 1), (.20, .40, .46, .52, 3),
            (.12, .76, .16, .84, 2), (.86, .76, .90, .84, 2)],
    "Dining": [(.10, .36, .90, .44, 1), (.16, .44, .22, .82, 0), (.78, .44, .84, .82, 0), (.42, .50, .58, .56, 2)],
    "Table": [(.20, .40, .80, .47, 1), (.24, .47, .29, .80, 0), (.71, .47, .76, .80, 0), (.29, .62, .71, .66, 2)],
    "Chair": [(.34, .50, .66, .58, 0), (.34, .16, .40, .82, 1), (.60, .58, .66, .82, 1), (.40, .22, .62, .44, 3)],
    "Wardrobe & Storage": [(.24, .12, .76, .84, 0), (.26, .14, .49, .82, 1), (.51, .14, .74, .82, 1),
                           (.46, .44, .48, .52, 2), (.52, .44, .54, .52, 2)],
    "Office": [(.10, .38, .90, .46, 1), (.12, .46, .36, .82, 0), (.82, .46, .88, .82, 0), (.16, .52, .32, .60, 2),
               (.16, .66, .32, .74, 2)],
}
PALETTES = [((150, 96, 52), (118, 72, 38), (72, 44, 24), (226, 212, 190)),
            ((120, 70, 44), (92, 52, 32), (56, 32, 20), (214, 200, 184)),
            ((176, 128, 78), (146, 102, 60), (96, 66, 38), (236, 226, 208)),
            ((84, 60, 50), (62, 44, 38), (38, 28, 24), (200, 190, 182))]


def _png(path, category: str, variant: int, w: int = 480, h: int = 360):
    """Write a small product illustration without any imaging library."""
    pal = PALETTES[variant % len(PALETTES)]
    top, bottom = (244, 240, 232), (222, 214, 202)
    floor_y = int(h * 0.84)
    rects = [(int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h), pal[t]) for x0, y0, x1, y1, t in SHAPES[category]]
    rows = bytearray()
    for y in range(h):
        f = y / h
        if y >= floor_y:
            base = (196, 184, 168)
        else:
            base = tuple(int(top[i] + (bottom[i] - top[i]) * f) for i in range(3))
        line = bytearray(bytes(base) * w)
        for x0, y0, x1, y1, col in rects:
            if y0 <= y < y1:
                line[x0 * 3:x1 * 3] = bytes(col) * (x1 - x0)
        rows.append(0)
        rows.extend(line)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))
    path.write_bytes(png)


def seed(db: DbSession):
    rnd = random.Random(42)
    now = datetime.utcnow().replace(microsecond=0)
    today = now.date()

    org = m.Organisation(name="Athena Furniture & Interiors", settings={})
    db.add(org)
    db.flush()
    oid = org.id
    settings = get_settings(db, oid)
    counters: dict[tuple[str, int], int] = {}

    def number(key: str, year: int = 0, width: int = 6) -> str:
        counters[(key, year)] = counters.get((key, year), 0) + 1
        prefix = DEFAULT_SETTINGS["prefixes"][key]
        n = str(counters[(key, year)]).zfill(width)
        return f"{prefix}-{year}-{n}" if year else f"{prefix}-{n}"

    # ----- branches and users -----
    branches = [m.Branch(org_id=oid, code=c, name=n) for c, n in
                (("BR-N", "Branch North"), ("BR-S", "Branch South"), ("BR-E", "Branch East"))]
    db.add_all(branches)
    db.flush()
    pw = hash_password(DEMO_PASSWORD)

    def user(login, name, role, designation, branch=None, phone=None):
        u = m.User(org_id=oid, login_id=login, name=name, role=role, designation=designation, password_hash=pw,
                   branch_id=branch.id if branch else None, phone=phone)
        db.add(u)
        return u

    superadmin = user("superadmin", "Anwar Hossain", ROLE_SUPER, "System Owner", phone="01711000001")
    pm = user("pm", "Mizanur Rahman", ROLE_PM, "Production Manager", phone="01711000002")
    apm1 = user("apm01", "Shahidul Islam", ROLE_APM, "Assistant Production Manager (APM 01)", phone="01711000003")
    apm2 = user("apm02", "Habibur Rahman", ROLE_APM, "Assistant Production Manager (APM 02)", phone="01711000004")
    store = user("store", "Delwar Hossain", ROLE_STORE, "Store Operator", phone="01711000005")
    sawmill = user("sawmill", "Abdul Jabbar", ROLE_SAWMILL, "Saw-Mill Supervisor", phone="01711000006")
    warehouse = user("warehouse", "Monir Uddin", ROLE_WAREHOUSE, "Warehouse & Delivery Officer", phone="01711000007")
    sales_names = [("Lamia Brown", 0, 0.24), ("Rashed Silva", 1, 0.86), ("Mitu Lee", 2, 0.66), ("Adnan Khan", 2, 0.44),
                   ("Sabrina Ali", 0, 0.78), ("Fahim Reza", 1, 0.93), ("Tania Noor", 1, 0.58), ("Omar Faruk", 0, 0.71)]
    sales = []
    for i, (name, b, perf) in enumerate(sales_names, start=1):
        u = user(f"sales{i}", name, ROLE_SALES, "Sales Admin", branches[b], f"0171200{i:04d}")
        u._perf = perf
        sales.append(u)
    db.flush()

    # ----- sites -----
    sites = {}
    for code, name, typ, apm in [("PS-01", "Production Site 01", "In-house", apm1), ("PS-02", "Production Site 02", "In-house", apm1),
                                 ("PS-03", "Production Site 03", "In-house", apm1), ("PS-04", "Production Site 04", "In-house", apm2),
                                 ("PS-05", "Production Site 05", "In-house", apm2), ("PS-06", "Production Site 06", "In-house", apm2),
                                 ("CS-01", "Contract Site 01", "Contract", apm1)]:
        s = m.Site(org_id=oid, code=code, name=name, type=typ, apm_id=apm.id)
        s.apm = apm
        db.add(s)
        sites[code] = s

    # ----- master data -----
    def master(kind, code, name, category=None, unit=None):
        db.add(m.MasterItem(org_id=oid, kind=kind, code=code, name=name, category=category, unit=unit))
    for c, n in PRODUCT_CATEGORIES:
        master("product_category", c, n)
    for c, n, cat, _ in PRODUCTS:
        master("product", c, n, cat)
    for c, n in MATERIAL_CATEGORIES:
        master("material_category", c, n)
    for c, n, cat, unit, _ in MATERIALS:
        master("material", c, n, cat, unit)
    for w in WOODS:
        master("wood", w, w)
    for s in ("Seasonal", "Non-Seasonal"):
        master("seasoning", s, s)
    for c, n in COLOURS:
        master("colour", c, n)

    # ----- product images -----
    image_files: dict[str, list[str]] = {}
    for cat in SHAPES:
        image_files[cat] = []
        for v in range(3):
            fname = f"sample-{cat.split()[0].lower()}-{v + 1}.png"
            _png(UPLOAD_DIR / fname, cat, v)
            image_files[cat].append(fname)

    # ----- customers -----
    customers = []
    for i, name in enumerate(CUSTOMERS):
        c = m.Customer(org_id=oid, code=number("customer"), name=name, phone=f"0181{rnd.randint(1000000, 9999999)}",
                       address=rnd.choice(["Gulshan, Dhaka", "Dhanmondi, Dhaka", "Uttara, Dhaka", "Banani, Dhaka",
                                           "Agrabad, Chattogram", "Mirpur, Dhaka", "Bashundhara, Dhaka"]))
        db.add(c)
        customers.append(c)
    db.flush()

    prod_by_code = {p[0]: p for p in PRODUCTS}
    mat_price = {x[0]: x for x in MATERIALS}

    def make_order(sa, placed_at, product_codes, state="placed", promised_days=35):
        o = m.Order(org_id=oid, customer_id=rnd.choice(customers).id, branch_id=sa.branch_id, sales_admin_id=sa.id,
                    state=state, created_at=placed_at)
        if state != "draft":
            o.order_no = number("order", placed_at.year)
            o.placed_at = placed_at
        if promised_days:
            o.promised_date = (placed_at + timedelta(days=promised_days)).date()
        for seq, code in enumerate(product_codes, start=1):
            pcode, pname, cat, price = prod_by_code[code]
            colour = rnd.choice(COLOURS)
            uph = cat in ("Sofa", "Chair") or (cat == "Bed" and rnd.random() < 0.5)
            it = m.OrderItem(seq=seq, product_code=pcode, product_name=pname, category=cat,
                             product_desc=f"{pname} in {colour[1].lower()} finish, made to order.",
                             design_desc=f"Design D-{rnd.randint(10, 48)}; " + rnd.choice(
                                 ["tapered legs, rounded edges", "straight profile, hidden joinery", "carved detail on front panel",
                                  "slim frame with recessed handles"]),
                             height=float(rnd.choice([30, 32, 34, 36, 42, 72, 78])), width=float(rnd.choice([24, 30, 36, 60, 72, 84])),
                             length=float(rnd.choice([18, 24, 36, 48, 72, 80])), colour_code=colour[0], colour_name=colour[1],
                             wood_category=rnd.choice(WOODS[:3]), seasoning=rnd.choice(["Seasonal", "Seasonal", "Non-Seasonal"]),
                             upholstery_needed=uph, amount=float(round(price * rnd.uniform(0.9, 1.15), -2)),
                             stage=wf.UNASSIGNED)
            files = rnd.sample(image_files[cat], k=rnd.choice([1, 2, 2, 3]))
            it.images = [m.ItemImage(filename=f, original_name=f"{pname} {i + 1}.png") for i, f in enumerate(files)]
            o.items.append(it)
        db.add(o)
        db.flush()
        return o

    def add_cost(item, at, n_lines=4, user_name=None):
        sheet = m.CostSheet(item_id=item.id, sheet_no=number("cost", at.year), created_at=at)
        item.cost_sheet = sheet
        db.add(sheet)
        mats = rnd.sample(MATERIALS, k=min(n_lines, 4))
        for i, (code, name, _cat, _unit, rate) in enumerate(mats):
            qty = rnd.randint(2, 14)
            sheet.lines.append(m.CostLine(name=name, material_code=code, rate=float(rate), per="Pcs",
                                          amount=float(rate * qty), entered_by=user_name or pm.name,
                                          entered_at=at + timedelta(days=i, hours=rnd.randint(1, 6))))
        for extra, lo, hi in (("Carpenter labour", 6000, 18000), ("Lacquer labour", 3000, 9000), ("Transport to warehouse", 800, 2500)):
            if len(sheet.lines) < n_lines + 2 and rnd.random() < 0.8:
                amt = float(rnd.randrange(lo, hi, 100))
                sheet.lines.append(m.CostLine(name=extra, rate=amt, per="Set", amount=amt, entered_by=pm.name,
                                              entered_at=at + timedelta(days=len(sheet.lines) + 1)))
        return sheet

    def progress(item, site_code, target, end_at, upholstery=False, m2=False, rework=None, in_rework=False,
                 reqs="done", partial_qc=True):
        """Walk an item along the stage path up to `target`, back-dating every record."""
        site = sites[site_code]
        apm = site.apm
        path = [(wf.ASSIGNED, "move"), (wf.MACHINE, "move"), (wf.SITE, "move")]
        if m2:
            path.append((wf.MACHINE2, "move"))
        path += [(wf.FORM_READY, "move"), (wf.CARPENTER, "move"), (wf.CARPENTER_QC, "move")]
        if rework == "carp":
            path += [(wf.CARPENTER, "rework"), (wf.CARPENTER_QC, "move")]
        path += [(wf.LACQUER, "move"), (wf.LACQUER_QC, "move")]
        if rework == "lacq":
            path += [(wf.LACQUER, "rework"), (wf.LACQUER_QC, "move")]
        if upholstery:
            path += [(wf.UPHOLSTERY, "move"), (wf.UPHOLSTERY_QC, "move")]
        path += [(wf.FINISH_GOOD, "move"), (wf.IN_WAREHOUSE, "move"), (wf.PACKED, "move"), (wf.READY, "move"),
                 (wf.DELIVERED, "move")]
        idx = [i for i, (s, k) in enumerate(path) if s == target and (k == "rework") == in_rework][-1]
        path = path[:idx + 1]
        durations = []
        for s, _k in path[:-1]:
            if s == wf.FINISH_GOOD:
                durations.append(timedelta(0))
            elif s in wf.QC_STAGES or s == wf.FORM_READY:
                durations.append(timedelta(hours=rnd.randint(6, 30)))
            else:
                durations.append(timedelta(hours=rnd.randint(20, 80)))
        t = end_at - sum(durations, timedelta(0))
        # never assign before the order was placed
        placed = item.order.placed_at
        if t < placed + timedelta(hours=3):
            item.order.placed_at = t - timedelta(hours=rnd.randint(4, 40))
            item.order.created_at = item.order.placed_at
        item.site_id = site.id
        item.site = site
        item.assigned_at = t
        visits = {wf.CARPENTER_QC: 0, wf.LACQUER_QC: 0, wf.UPHOLSTERY_QC: 0}

        def result(check, res, at, note=None):
            item.qc.results.append(m.QCResult(check=check, result=res, checker_name=apm.name, checker_id=apm.id, at=at, note=note))

        for i, (stage, kind) in enumerate(path):
            last = i == len(path) - 1
            end = None if last else t + durations[i]
            who = pm if stage == wf.ASSIGNED else (warehouse if stage in (wf.PACKED, wf.READY, wf.DELIVERED) else apm)
            note = None
            if stage == wf.ASSIGNED:
                note = f"Assigned to {site.code} ({apm.name})"
            if kind == "rework":
                note = ("Rework from Final Carpenter Fitting QC: drawer alignment off by 3 mm" if stage == wf.CARPENTER
                        else "Rework from Before Colour QC: uneven sanding on side panel")
                item.rework_count += 1
            if stage == wf.IN_WAREHOUSE:
                note = "Moved to Product Warehouse"
            h = m.StageHistory(item_id=item.id, stage=stage, kind=kind, started_at=t, ended_at=end, user_id=who.id,
                               user_name=who.name, note=note)
            item.history.append(h)
            item.stage = stage
            item.stage_since = t
            done_at = (end or now) - timedelta(minutes=20)

            if stage == wf.ASSIGNED:
                if reqs != "none":
                    status = {"done": "Issued", "open": "Submitted", "returned": "Returned", "partly": "Partly Issued"}[reqs]
                    sr = m.StoreRequisition(org_id=oid, req_no=number("store_req", t.year, 5), item_id=item.id, apm_id=apm.id,
                                            status=status, submitted_at=t + timedelta(hours=2), versions=[])
                    for code, name, cat, unit, _rate in rnd.sample(MATERIALS, k=rnd.randint(2, 4)):
                        qty = float(rnd.randint(2, 12))
                        issued = qty if status == "Issued" else (max(1.0, qty - 2) if status == "Partly Issued" else None)
                        sr.lines.append(m.StoreReqLine(material_code=code, material_name=name, category=cat, measurement=unit,
                                                       quantity=qty, issued_qty=issued,
                                                       colour_code=item.colour_code if cat == "Chemicals & Finish" else None))
                    if status in ("Issued", "Partly Issued"):
                        sr.processed_at, sr.processed_by = t + timedelta(hours=7), store.name
                    if status == "Returned":
                        sr.processed_at, sr.processed_by = t + timedelta(hours=5), store.name
                        sr.return_reason = "Foam density not specified. Please confirm 32D or 40D."
                    item.store_reqs.append(sr)
                    wstatus = {"done": "Completed", "open": "In Progress", "returned": "Submitted", "partly": "Completed"}[reqs]
                    wr = m.WoodRequisition(org_id=oid, req_no=number("wood_req", t.year, 5), item_id=item.id, apm_id=apm.id,
                                           wood_category=item.wood_category, seasoning=item.seasoning,
                                           quantity=float(rnd.randint(6, 18)),
                                           measurement=rnd.choice(["6 ft x 4 in x 2 in", "8 ft x 6 in x 1.5 in", "5 ft x 3 in x 3 in"]),
                                           status=wstatus, submitted_at=t + timedelta(hours=2, minutes=30), versions=[])
                    if wstatus == "Completed":
                        wr.processed_at, wr.processed_by = t + timedelta(hours=14), sawmill.name
                    elif wstatus == "In Progress":
                        wr.processed_at, wr.processed_by = t + timedelta(hours=6), sawmill.name
                    item.wood_reqs.append(wr)
                elif not last:
                    item.no_req_remark = "Materials already available at site from the previous batch."
            if stage in (wf.MACHINE, wf.MACHINE2):
                item.machine_passes += 1
            if stage == wf.CARPENTER_QC:
                visits[stage] += 1
                if not item.qc:
                    item.qc = m.QCReport(item_id=item.id, qc_ref=number("qc", t.year), created_at=t,
                                         carpenter_side=rnd.choice(CARPENTER_TEAMS))
                    db.add(item.qc)
                if rework == "carp" and visits[stage] == 1:
                    result("carp_before", "Pass", done_at - timedelta(hours=1))
                    result("carp_final", "Rework", done_at, "Drawer alignment off by 3 mm")
                elif not last:
                    if visits[stage] == 1:
                        result("carp_before", "Pass", done_at - timedelta(hours=1))
                    result("carp_final", "Pass", done_at)
                elif partial_qc and visits[stage] == 1:
                    result("carp_before", "Pass", t + timedelta(hours=2))
            if stage == wf.LACQUER_QC:
                visits[stage] += 1
                if rework == "lacq" and visits[stage] == 1:
                    result("lacq_before", "Rework", done_at, "Uneven sanding on side panel")
                elif not last:
                    result("lacq_before", "Pass", done_at - timedelta(hours=1))
                    result("lacq_final", "Pass", done_at)
                elif partial_qc:
                    result("lacq_before", "Pass", t + timedelta(hours=2))
            if stage == wf.UPHOLSTERY:
                item.upholstery_added = True
            if stage == wf.UPHOLSTERY_QC and not last:
                result("upholstery", "Pass", done_at)
            if stage == wf.FINISH_GOOD:
                item.finish_good_at = t
                item.final_height, item.final_width, item.final_length = item.height, item.width, item.length
                item.qc.apm_signed_by, item.qc.apm_signed_at = apm.name, t
                item.qc.remarks = "Fixed" if rework else None
            if stage == wf.PACKED:
                item.packed_at = t
            if stage == wf.READY:
                item.ready_at = t
            if stage == wf.DELIVERED:
                h.ended_at = t
                item.delivered_at = t
                item.delivery_date = t.date()
                item.delivered_by = rnd.choice(DELIVERY_STAFF)
                item.receiver_name = item.order.customer.name
                h.note = f"Delivered by {item.delivered_by}; received by {item.receiver_name}"
            if not last:
                t = end
        return item

    def deliver(item, pm_sign=True, cost=True):
        if pm_sign and item.qc:
            item.qc.pm_signed_by, item.qc.pm_signed_at = pm.name, item.finish_good_at + timedelta(hours=3)
        if cost:
            add_cost(item, item.assigned_at + timedelta(days=1), rnd.randint(3, 5))
        db.flush()
        rep = wf.generate_report(db, item, None, settings)
        rep.generated_at = item.delivered_at + timedelta(seconds=20)
        counters[("report", item.delivered_at.year)] = counters.get(("report", item.delivered_at.year), 0)
        return rep

    def ago(days, hours=0):
        return now - timedelta(days=days, hours=hours)

    S = sales
    # ----- delivered orders (spread over past months) -----
    delivered_specs = [
        (S[1], 150, ["100045"], "PS-02", dict(upholstery=True, rework="lacq")),
        (S[5], 128, ["120001", "120003"], "PS-04", dict()),
        (S[2], 110, ["110001"], "PS-01", dict(rework="carp", m2=True)),
        (S[4], 92, ["150001"], "PS-05", dict()),
        (S[0], 80, ["100001"], "CS-01", dict(upholstery=True)),
        (S[6], 66, ["160001"], "PS-06", dict()),
        (S[7], 52, ["130001", "130003"], "PS-03", dict()),
        (S[3], 44, ["140001"], "PS-02", dict(upholstery=True)),
    ]
    delivered_items = []
    for sa, days, codes, site, kw in delivered_specs:
        o = make_order(sa, ago(days), codes)
        for n, it in enumerate(o.items):
            progress(it, site, wf.DELIVERED, ago(days - 24 - n * 2 - rnd.randint(0, 5)), **(kw if n == 0 else {}))
            delivered_items.append(it)
    db.flush()
    for it in delivered_items:
        deliver(it)

    # one delivered item gets a late cost line -> Production Report revision R1 (TS-19)
    late = delivered_items[0]
    late.cost_sheet.lines.append(m.CostLine(name="Touch-up lacquer after delivery inspection", rate=1800.0, per="Set",
                                            amount=1800.0, entered_by=pm.name, entered_at=late.delivered_at + timedelta(days=2)))
    voided = delivered_items[2].cost_sheet.lines[0]
    voided.voided, voided.void_reason, voided.voided_by = True, "Entered against the wrong item", pm.name
    voided.voided_at = voided.entered_at + timedelta(days=1)
    db.flush()
    r1 = wf.generate_report(db, late, pm, settings, "Cost line added: touch-up lacquer invoiced after delivery")
    r1.generated_at = late.delivered_at + timedelta(days=2)
    r2 = wf.generate_report(db, delivered_items[2], pm, settings, "Cost line voided: Entered against the wrong item")
    r2.generated_at = voided.voided_at

    # ----- partly delivered order -----
    o = make_order(S[1], ago(40), ["110002", "130003"])
    progress(o.items[0], "PS-01", wf.DELIVERED, ago(4))
    deliver(o.items[0])
    progress(o.items[1], "PS-01", wf.READY, ago(1))
    o.items[1].qc.pm_signed_by, o.items[1].qc.pm_signed_at = pm.name, ago(3)
    add_cost(o.items[1], o.items[1].assigned_at + timedelta(days=1), 3)

    # ----- completed (warehouse) -----
    for sa, days, code, site, target, age, kw in [
        (S[5], 34, "100002", "PS-04", wf.IN_WAREHOUSE, 1, dict(upholstery=True)),
        (S[4], 31, "120002", "PS-05", wf.PACKED, 1, dict()),
        (S[2], 29, "150003", "PS-03", wf.READY, 0, dict(rework="lacq")),
        (S[7], 27, "130002", "CS-01", wf.IN_WAREHOUSE, 2, dict()),
    ]:
        o = make_order(sa, ago(days), [code])
        it = progress(o.items[0], site, target, ago(age, 3), **kw)
        add_cost(it, it.assigned_at + timedelta(days=1), 4)
        if target != wf.IN_WAREHOUSE:
            it.qc.pm_signed_by, it.qc.pm_signed_at = pm.name, it.finish_good_at + timedelta(hours=5)

    # ----- in production: every stage on every site -----
    production_specs = [
        (S[0], 6, ["100003"], "PS-01", wf.ASSIGNED, 1, dict(reqs="open")),
        (S[1], 7, ["130001"], "PS-04", wf.ASSIGNED, 2, dict(reqs="returned")),
        (S[2], 5, ["150002"], "PS-02", wf.ASSIGNED, 0, dict(reqs="none")),
        (S[3], 9, ["120003"], "PS-06", wf.ASSIGNED, 1, dict(reqs="done")),
        (S[4], 12, ["110001"], "PS-02", wf.MACHINE, 1, dict(reqs="partly")),
        (S[5], 13, ["160002"], "PS-05", wf.MACHINE, 2, dict()),
        (S[6], 15, ["100001"], "PS-03", wf.SITE, 2, dict()),
        (S[7], 16, ["150001"], "PS-04", wf.SITE, 7, dict()),
        (S[0], 18, ["120001"], "CS-01", wf.MACHINE2, 1, dict(m2=True)),
        (S[1], 17, ["110003"], "PS-06", wf.FORM_READY, 0, dict()),
        (S[2], 21, ["100045"], "PS-01", wf.CARPENTER, 3, dict()),
        (S[3], 22, ["140002"], "PS-05", wf.CARPENTER, 9, dict()),
        (S[4], 24, ["130002"], "PS-02", wf.CARPENTER_QC, 0, dict()),
        (S[5], 26, ["100002"], "PS-03", wf.CARPENTER, 1, dict(rework="carp", in_rework=True)),
        (S[6], 27, ["160001"], "PS-04", wf.LACQUER, 2, dict()),
        (S[7], 30, ["110002"], "PS-06", wf.LACQUER_QC, 0, dict()),
        (S[0], 32, ["150003"], "PS-01", wf.LACQUER, 1, dict(rework="lacq", in_rework=True)),
        (S[1], 33, ["100001"], "PS-05", wf.UPHOLSTERY, 2, dict(upholstery=True)),
        (S[2], 36, ["140001"], "CS-01", wf.UPHOLSTERY_QC, 0, dict(upholstery=True, rework="carp")),
        (S[5], 20, ["120002", "120003"], "PS-04", wf.CARPENTER, 2, dict()),
    ]
    for sa, days, codes, site, target, age, kw in production_specs:
        o = make_order(sa, ago(days), codes, promised_days=rnd.choice([20, 30, 40, 45]))
        for n, it in enumerate(o.items):
            if n == 0:
                progress(it, site, target, ago(age, rnd.randint(1, 8)), **kw)
            else:
                progress(it, site, wf.MACHINE, ago(age + 1, 2))
            if it.stage != wf.ASSIGNED:
                add_cost(it, it.assigned_at + timedelta(days=1), rnd.randint(1, 3))

    # ----- pending, returned, cancelled, drafts -----
    make_order(S[0], ago(0, 5), ["100045"])
    make_order(S[3], ago(1, 2), ["110001", "130003"])
    make_order(S[6], ago(1, 9), ["150001"])
    o = make_order(S[4], ago(2), ["120001", "120003"])
    progress(o.items[0], "PS-05", wf.ASSIGNED, ago(1, 4), reqs="open")  # still Pending: second item unassigned
    o = make_order(S[2], ago(3), ["140002"])
    o.state = "returned"
    o.return_reason = "Seat height is missing from the design description. Please confirm with the customer."
    o = make_order(S[5], ago(19), ["130002"])
    o.state = "cancelled"
    o.cancel_reason = "Customer cancelled before production started."
    make_order(S[0], ago(0, 2), ["130001"], state="draft", promised_days=0)
    make_order(S[0], ago(1, 1), ["140001"], state="draft", promised_days=0)
    db.flush()

    # ----- sales targets, entries and leads: twelve months -----
    months = []
    y, mo = today.year, today.month
    for i in range(11, -1, -1):
        idx = y * 12 + (mo - 1) - i
        months.append((idx // 12, idx % 12 + 1))
    for sa in sales:
        for (yy, mm) in months:
            grow = 1 + 0.02 * months.index((yy, mm))
            target = {"sales": 4_000_000 * grow, "collection": 4_000_000 * grow, "delivery": 4_000_000 * grow,
                      "visits": 40, "leads": 12, "orders": 6}
            target = {k: float(round(v, -3)) if k not in ("visits", "leads", "orders") else float(v) for k, v in target.items()}
            db.add(m.SalesTarget(org_id=oid, sales_admin_id=sa.id, year=yy, month=mm, **target))
            last_day = calendar.monthrange(yy, mm)[1]
            is_current = (yy, mm) == (today.year, today.month)
            limit = today.day if is_current else last_day
            share = min(1.0, limit / last_day * 1.9) if is_current else 1.0  # month to date runs ahead of a straight line
            perf = max(0.1, min(1.15, sa._perf * rnd.uniform(0.8, 1.2)))
            days = [d for d in range(1, limit + 1) if date(yy, mm, d).weekday() != 4]  # Friday off
            work = sorted(rnd.sample(days, k=max(1, int(len(days) * 0.72))))
            tot_sales = target["sales"] * perf * share
            weights = [rnd.uniform(0.4, 1.6) for _ in work]
            wsum = sum(weights)
            for d, wgt in zip(work, weights):
                s_amt = round(tot_sales * wgt / wsum, -2)
                db.add(m.SalesEntry(org_id=oid, entry_no=number("sales_entry", yy), sales_admin_id=sa.id,
                                    branch_id=sa.branch_id, entry_date=date(yy, mm, d), sales=float(s_amt),
                                    collection=float(round(s_amt * rnd.uniform(0.55, 0.95), -2)),
                                    delivery=float(round(s_amt * rnd.uniform(0.6, 0.98), -2)),
                                    visits=max(0, round(40 * perf * share * wgt / wsum + rnd.uniform(-0.4, 0.6))),
                                    created_at=datetime(yy, mm, d, 12)))
    lost_reasons = ["Price higher than budget", "Chose another supplier", "Delivery time too long", "Project postponed"]
    for (yy, mm) in months:
        recent = months.index((yy, mm))
        last_day = today.day if (yy, mm) == (today.year, today.month) else calendar.monthrange(yy, mm)[1]
        for _ in range(5 + recent // 2 + (5 if recent == 11 else 0)):
            sa = rnd.choices(sales, weights=[0.6 + s._perf for s in sales])[0]
            d = date(yy, mm, rnd.randint(1, last_day))
            age = (today - d).days
            if age > 45:
                stage = rnd.choices(["Won", "Lost", "Negotiation"], weights=[40 + 40 * sa._perf, 45, 8])[0]
            elif age > 14:
                stage = rnd.choices(wf.LEAD_STAGES, weights=[2, 6, 10, 14, 14, 30 * sa._perf + 8, 12])[0]
            else:
                stage = rnd.choices(wf.LEAD_STAGES, weights=[20, 20, 14, 12, 8, 30 * sa._perf, 5])[0]
            status = {"Won": "Closed Won", "Lost": "Closed Lost"}.get(stage, "Open")
            closed = None
            if status != "Open":
                closed = min(today, d + timedelta(days=rnd.randint(3, 28)))
            db.add(m.Lead(org_id=oid, lead_no=number("lead", yy, 5), sales_admin_id=sa.id, branch_id=sa.branch_id,
                          lead_date=d, customer_name=rnd.choice(CUSTOMERS), customer_phone=f"0191{rnd.randint(1000000, 9999999)}",
                          expected_value=float(rnd.randrange(60_000, 520_000, 5_000)), stage=stage, status=status,
                          lost_reason=rnd.choice(lost_reasons) if stage == "Lost" else None,
                          next_followup=(today + timedelta(days=rnd.randint(1, 10))) if status == "Open" else None,
                          remarks=rnd.choice([None, "Referred by an existing customer", "Walk-in at showroom",
                                              "Enquiry from social media", "Corporate fit-out enquiry"]),
                          closed_on=closed, created_at=datetime(yy, mm, d.day, 11)))
    # lock closed periods older than last month
    for (yy, mm) in months[:-2]:
        db.add(m.PeriodLock(org_id=oid, year=yy, month=mm, locked_by=superadmin.name,
                            locked_at=datetime(yy, mm, 1) + timedelta(days=36)))

    # ----- persist counters (reports were numbered by the service itself) -----
    db.flush()
    for (key, year), value in counters.items():
        if key == "report":
            continue
        row = db.query(m.Counter).filter_by(org_id=oid, key=key, year=year).first()
        if row:
            row.value = max(row.value, value)
        else:
            db.add(m.Counter(org_id=oid, key=key, year=year, value=value))
    db.add(m.AuditLog(org_id=oid, user_name="System", action="SEED", entity="Organisation", ref=org.name,
                      detail="Sample data loaded for the prototype"))
    db.commit()
