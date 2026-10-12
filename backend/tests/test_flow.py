"""End-to-end API test against a running server: walks one order from New Order to Delivered and
checks the BRD key test scenarios (Section 11.2). Run:  python tests/test_flow.py [base_url]
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000") + "/api"
PW = "Athena@123"
import random
TAG = str(random.randint(100000, 999999))
CUST = f"Test Customer {TAG}"
results = []


def call(method, path, token=None, body=None, raw=None, headers=None):
    h = {"Content-Type": "application/json"} if raw is None else dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload).get("detail")
        except Exception:
            return e.code, payload.decode(errors="replace")


def login(uid):
    s, d = call("POST", "/auth/login", body={"login_id": uid, "password": PW})
    assert s == 200, (uid, s, d)
    return d["token"]


def check(tid, ok, note=""):
    results.append((tid, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + tid + (f"  {note}" if note else ""))


def msg(d):
    return d.get("message") if isinstance(d, dict) else str(d)


def upload_png(token, size=None):
    import struct, zlib
    raw = b"\x00" + b"\xc8\xa0\x78" * 8
    def chunk(t, dd):
        return struct.pack(">I", len(dd)) + t + dd + struct.pack(">I", zlib.crc32(t + dd) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw * 8)) + chunk(b"IEND", b""))
    if size:
        png += b"\x00" * size
    boundary = "----athenatest"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{boundary}--\r\n".encode()
    return call("POST", "/files", token, raw=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


sa = login("sales1")
sa2 = login("sales2")
pm = login("pm")
apm1 = login("apm01")
apm2 = login("apm02")
store = login("store")
saw = login("sawmill")
wh = login("warehouse")
sup = login("superadmin")

s, meta = call("GET", "/meta", sa)
sites = {x["code"]: x["id"] for x in meta["sites"]}
mat = meta["masters"]["material"][0]["code"]

# ---- TS-01..04: order capture ----
_, f1 = upload_png(sa)
_, f2 = upload_png(sa)
item = {"product_code": "100001", "product_desc": "Test sofa", "design_desc": "D-99", "height": 34, "width": 84,
        "length": 36, "colour_code": "CL-208", "wood_category": "Mahogany", "seasoning": "Seasonal",
        "upholstery_needed": True, "amount": 185000, "images": [f1["file"], f2["file"]]}
order_body = {"customer": {"name": CUST, "phone": "01999" + TAG}, "place": True, "items": [item],
              "promised_date": (date.today() + timedelta(days=30)).isoformat()}
s, d = call("POST", "/orders", sa, order_body)
check("TS-01 place order with two images", s == 200 and d["status"] == "Pending" and d["order_no"].startswith("ATH-"), msg(d))
order_id, order_no = d["id"], d["order_no"]
s, lst = call("GET", "/orders?status=Pending", pm)
check("TS-01 visible to Production Manager", any(o["id"] == order_id for o in lst))

bad = dict(item, length="")
s, d = call("POST", "/orders", sa, {**order_body, "items": [bad], "customer_id": 1, "customer": None})
check("TS-02 Length empty blocked", s == 422 and d["fields"].get("items.0.length") == "Please enter Length.", str(d))
s, d = upload_png(sa, size=6 * 1024 * 1024)
check("TS-03 oversize image rejected", s == 422 and "Use JPG or PNG up to 5 MB" in str(d), str(d))
s, cust = call("GET", "/customers?q=" + TAG, sa)
dup_body = {**order_body, "customer": None, "customer_id": cust[0]["id"]}
s, d = call("POST", "/orders", sa, dup_body)
check("TS-04 duplicate warning", s == 409 and d.get("code") == "duplicate", msg(d))
s, d = call("POST", "/orders", sa, {**dup_body, "confirm_duplicate": True})
check("TS-04 saved after confirmation", s == 200, msg(d))
dup_order_id = d["id"]

# ---- TS-05/06: assignment ----
s, od = call("GET", f"/orders/{order_id}", pm)
item_id = od["items"][0]["id"]
s, d = call("POST", f"/items/{item_id}/assign", pm, {"site_id": sites["CS-01"]})
check("TS-05 assign to CS-01", s == 200, msg(d))
s, w1 = call("GET", "/items?scope=production", apm1)
s, w2 = call("GET", "/items?scope=production", apm2)
check("TS-05 item on APM 01 list only", any(i["id"] == item_id for i in w1) and not any(i["id"] == item_id for i in w2))
s, d = call("GET", f"/items/{item_id}", apm2)
check("TS-16 APM 02 refused by direct link", s == 403, str(d))
s, logs = call("GET", "/audit?action=ACCESS_DENIED", sup)
check("TS-16 attempt in audit log", any("apm02" in (l.get("detail") or "") for l in logs))
s, d = call("POST", f"/items/{item_id}/assign", pm, {"site_id": sites["PS-02"]})
check("FR-PM-05 reassign before Machine Room", s == 200, msg(d))

# ---- TS-07..09: requisitions ----
s, d = call("POST", "/store-requisitions", apm1, {"item_id": item_id, "lines": [{"material_code": "9999999", "quantity": 2}]})
check("TS-07 unknown material code blocked", s == 422 and "was not found" in str(d), str(d))
s, d = call("POST", "/items/%d/move" % item_id, apm1, {"to": "Machine Room"})
check("BR-04 Machine Room blocked without requisition", s == 409, str(d))
s, d = call("POST", "/store-requisitions", apm1, {"item_id": item_id, "lines": [{"material_code": mat, "quantity": 4}]})
check("FR-APM-02 store requisition submitted", s == 200, msg(d))
s, inbox = call("GET", "/store-requisitions?status=Submitted", store)
req = next(r for r in inbox if r["item_id"] == item_id)
check("FR-ST-01 Store Operator sees APM name", req["apm"] == "Shahidul Islam")
s, d = call("POST", f"/items/{item_id}/move", apm1, {"to": "Machine Room"})
check("TS-09 Machine Room blocked with open requisition", s == 409 and "must be completed first" in str(d), str(d))
s, d = call("POST", f"/store-requisitions/{req['id']}/process", store, {"action": "return", "reason": "Specify grade"})
check("TS-08 requisition returned", s == 200, msg(d))
s, mine = call("GET", "/store-requisitions", apm1)
r2 = next(r for r in mine if r["id"] == req["id"])
check("TS-08 APM sees reason", r2.get("return_reason") == "Specify grade")
s, d = call("PUT", f"/store-requisitions/{req['id']}", apm1, {"lines": [{"material_code": mat, "quantity": 5, "details": "Grade A"}]})
s, mine = call("GET", "/store-requisitions", apm1)
r2 = next(r for r in mine if r["id"] == req["id"])
check("TS-08 resubmitted with both versions", r2["version"] == 2 and len(r2["versions"]) == 1 and r2["req_no"] == req["req_no"])
s, d = call("POST", f"/store-requisitions/{req['id']}/process", store, {"action": "issue"})
s, d = call("POST", "/wood-requisitions", apm1, {"item_id": item_id, "wood_category": "Mahogany", "seasoning": "Seasonal",
                                                 "quantity": 12, "measurement": "6 ft x 4 in x 2 in"})
check("FR-APM-04 wood requisition submitted", s == 200, msg(d))
s, winbox = call("GET", "/wood-requisitions", saw)
wr = next(r for r in winbox if r["item_id"] == item_id)
call("POST", f"/wood-requisitions/{wr['id']}/process", saw, {"action": "start"})
s, d = call("POST", f"/wood-requisitions/{wr['id']}/process", saw, {"action": "complete"})
check("FR-SM-02 wood requisition completed", s == 200, msg(d))

# ---- cost entry (TS-20..22) ----
s, d = call("POST", f"/cost/items/{item_id}/lines", pm, {"name": "Foam", "rate": 100, "per": "", "amount": 0})
check("TS-20 cost line with Per empty / Amount 0 blocked", s == 422 and "per" in d["fields"] and "amount" in d["fields"], str(d))
call("POST", f"/cost/items/{item_id}/lines", pm, {"name": "Mahogany timber", "rate": 2400, "per": "Pcs", "amount": 12000})
s, d = call("POST", f"/cost/items/{item_id}/lines", pm, {"name": "Foam sheet", "rate": 3500, "per": "Set", "amount": 3500})
check("FR-PC-05 total = sum of lines", s == 200 and d["total"] == 15500, str(d))
s, sheet = call("GET", f"/cost/items/{item_id}", pm)
second = sheet["lines"][1]["id"]
s, d = call("POST", f"/cost/lines/{second}/void", pm, {"reason": "Wrong item"})
s, sheet = call("GET", f"/cost/items/{item_id}", pm)
check("TS-21 void keeps history, total 12,000", sheet["total"] == 12000 and len(sheet["lines"]) == 2 and sheet["lines"][1].get("voided"))
s, d = call("GET", f"/cost/items/{item_id}", store)
check("TS-22 Store Operator refused cost sheet", s == 403, str(d))
s, d = call("GET", f"/items/{item_id}", apm1)
check("Cost never sent to APM", "cost" not in d)

# ---- TS-06, stages, QC (TS-10..12) ----
def mv(to, tok=apm1, **kw):
    return call("POST", f"/items/{item_id}/move", tok, {"to": to, **kw})

s, d = mv("Machine Room")
check("Stage: Machine Room started", s == 200, msg(d))
s, d = call("POST", f"/items/{item_id}/assign", pm, {"site_id": sites["PS-01"]})
check("TS-06 PM blocked after Machine Room", s == 409, str(d))
s, d = call("POST", f"/items/{item_id}/assign", sup, {"site_id": sites["PS-01"], "reason": "Machine breakdown at PS-02"})
check("TS-06 Super Admin reassigns with reason", s == 200, msg(d))
s, d = mv("Carpenter")
check("BR-05 Carpenter blocked before Form/Design Ready", s == 409 and "Form/Design Ready must be completed first" in str(d), str(d))
mv("Production Site")
s, d = mv("Form/Design Ready")
s, d = mv("Carpenter")
check("FR-WF-02 Carpenter after Form/Design Ready", s == 200, msg(d))
s, d = mv("Carpenter QC")
check("FR-QC-01 QC report created at Carpenter QC", s == 200 and d["item"]["qc"]["qc_ref"].startswith("QC-"))
qc_ref = d["item"]["qc"]["qc_ref"]

def qc(check_key, result, note=None):
    return call("POST", f"/items/{item_id}/qc/result", apm1, {"check": check_key, "result": result, "note": note})

s, d = mv("Lacquer")
check("BR-06 Lacquer blocked before Carpenter QC passes", s == 409, str(d))
qc("carp_before", "Pass")
qc("carp_final", "Pass")
mv("Lacquer")
mv("Lacquer QC")
s, d = qc("lacq_before", "Rework", "Uneven colour")
check("TS-10 Rework returns item to Lacquer", s == 200 and d["item"]["stage"] == "Lacquer" and d["item"]["status"] == "Rework", msg(d))
mv("Lacquer QC")
qc("lacq_before", "Pass")
s, d = qc("lacq_final", "Pass")
hist = [h["result"] for h in d["item"]["qc"]["checks"]["lacq_before"]["history"]]
check("TS-10 QC report shows Rework then Pass", hist == ["Rework", "Pass"], str(hist))
moves = {m["to"]: m for m in d["item"]["moves"]}
check("FR-WF-03 Finish Good and + Upholstery offered", set(moves) == {"Finish Good", "Upholstery"} and moves["Finish Good"]["enabled"])
s, d = mv("Upholstery")
s, d = mv("Finish Good")
check("TS-12 Finish Good blocked before Upholstery QC", s == 409, str(d))
s, d = mv("Upholstery QC")
moves = {m["to"]: m for m in d["item"]["moves"]}
check("TS-12 Finish Good disabled with explanation", not moves["Finish Good"]["enabled"] and "Upholstery QC" in moves["Finish Good"]["reason"])
s, d = qc("upholstery", "Pass")
check("FR-QC-04 one QC report with upholstery column", d["item"]["qc"]["qc_ref"] == qc_ref and "upholstery" in d["item"]["qc"]["checks"])
call("PUT", f"/items/{item_id}/qc", apm1, {"carpenter_side": "Team B", "remarks": "Fixed"})
s, d = mv("Finish Good", final_height=34, final_width=84, final_length=36.5)
check("BR-07 Finish Good after all QC pass", s == 200 and d["item"]["stage"] == "In Warehouse", msg(d))
s, d = call("POST", f"/items/{item_id}/qc/sign", apm1)
s, d2 = call("POST", f"/items/{item_id}/qc/sign", pm)
check("FR-QC-06 APM and PM digital sign-off", s == 200 and d2.get("ok"), msg(d2))

# ---- TS-11 item without upholstery (second order) ----
s, od2 = call("GET", f"/orders/{dup_order_id}", pm)
i2 = od2["items"][0]["id"]
call("POST", f"/items/{i2}/assign", pm, {"site_id": sites["PS-04"]})
call("POST", f"/items/{i2}/no-requisition", apm2, {"remark": "Stock on site"})
for to in ("Machine Room", "Production Site", "Form/Design Ready", "Carpenter", "Carpenter QC"):
    call("POST", f"/items/{i2}/move", apm2, {"to": to})
for c in ("carp_before", "carp_final"):
    call("POST", f"/items/{i2}/qc/result", apm2, {"check": c, "result": "Pass"})
for to in ("Lacquer", "Lacquer QC"):
    call("POST", f"/items/{i2}/move", apm2, {"to": to})
for c in ("lacq_before", "lacq_final"):
    call("POST", f"/items/{i2}/qc/result", apm2, {"check": c, "result": "Pass"})
s, d = call("POST", f"/items/{i2}/move", apm2, {"to": "Finish Good"})
check("TS-11 Finish Good without upholstery", s == 200 and "upholstery" not in d["item"]["qc"]["checks"], msg(d))

# ---- TS-13, TS-17: warehouse, delivery, Production Report ----
s, wl = call("GET", "/items?scope=warehouse", wh)
check("FR-GD-01 item in Warehouse List", any(i["id"] == item_id for i in wl))
s, d = call("POST", f"/items/{item_id}/warehouse", wh, {"action": "ready"})
check("BR-10 warehouse order enforced", s == 409, str(d))
call("POST", f"/items/{item_id}/warehouse", wh, {"action": "pack"})
call("POST", f"/items/{item_id}/warehouse", wh, {"action": "ready"})
s, d = call("POST", f"/items/{item_id}/warehouse", wh, {"action": "deliver", "delivery_date": date.today().isoformat()})
check("FR-GD-02 Delivered requires delivered-by and receiver", s == 422, str(d))
s, d = call("POST", f"/items/{item_id}/warehouse", wh, {"action": "deliver", "delivery_date": date.today().isoformat(),
                                                        "delivered_by": "D. Driver", "receiver_name": CUST})
check("TS-13 Delivered; order shows Delivered", s == 200 and d["order_status"] == "Delivered", msg(d))
report_no = d.get("report_no", "")
s, reps = call("GET", "/production-reports", sup)
rep = next((r for r in reps if r["report_no"] == report_no), None)
check("TS-17 Production Report generated", rep is not None and report_no.startswith("PR-"), report_no)
s, full = call("GET", f"/production-reports/{rep['id']}", sup)
data = full["data"]
check("TS-17 report has all sections", all(k in data for k in ("product", "materials", "stages", "qc", "cost", "delivery"))
      and data["cost"]["total"] == 12000 and len(data["materials"]) == 2, str(data.get("missing")))
s, sfull = call("GET", f"/production-reports/{rep['id']}", sa)
check("DEC-19 Sales Admin sees report without cost", s == 200 and "cost" not in sfull["data"])
s, d = call("GET", f"/production-reports/{rep['id']}", sa2)
check("Report refused to another branch", s in (403, 404), str(d))

# ---- TS-18/19: cost after delivery ----
s, d = call("POST", f"/cost/items/{item_id}/lines", pm, {"name": "Late transport", "rate": 900, "per": "Set", "amount": 900})
check("TS-18 cost after delivery without reason blocked", s == 422 and "Please give a reason" in str(d), str(d))
s, d = call("POST", f"/cost/items/{item_id}/lines", pm, {"name": "Late transport", "rate": 900, "per": "Set", "amount": 900,
                                                         "reason": "Invoice arrived late"})
check("TS-19 revision R1 created", s == 200 and d["revision"] == report_no + "-R1", msg(d))
s, reps = call("GET", "/production-reports", sup)
cur = next(r for r in reps if r["item_id"] == item_id)
s, full = call("GET", f"/production-reports/{cur['id']}", sup)
check("TS-19 original revision kept", len(full["revisions"]) == 2 and full["data"]["cost"]["total"] == 12900)

# ---- TS-14 APM deactivation ----
s, apms = call("GET", "/apms", pm)
a1 = next(a for a in apms if a["login_id"] == "apm01")
s, d = call("POST", f"/apms/{a1['id']}/deactivate", pm)
check("TS-14 deactivate APM with open items blocked", s == 409, str(d))

# ---- TS-15 dashboard totals ----
s, dash = call("GET", "/dashboard/management?mode=quarterly", sup)
s, orders = call("GET", "/orders", sup)
q_months = {(date.today().year, m) for m in range(((date.today().month - 1) // 3) * 3 + 1, ((date.today().month - 1) // 3) * 3 + 4)}
expected = [o for o in orders if o["status"] not in ("Draft", "Cancelled")
            and (int(o["order_date"][:4]), int(o["order_date"][5:7])) in q_months]
check("TS-15 dashboard totals match order list", dash["cards"]["total_orders"] == len(expected),
      f"{dash['cards']['total_orders']} vs {len(expected)}")
s, mon = call("GET", "/items?scope=open", sup)
check("Monitor counts match open items", dash["open_items"] == len(mon), f"{dash['open_items']} vs {len(mon)}")

# ---- sales record (TS-23..26) ----
today = date.today().isoformat()
s, d = call("POST", "/sales/entries", sa, {"entry_date": today, "sales": 50000, "collection": 20000, "delivery": 0, "visits": 2})
first_existing = isinstance(d, dict) and d.get("existing")
if first_existing:
    s, d = call("POST", "/sales/entries", sa, {"id": d["entry"]["id"], "entry_date": today, "sales": 50000, "collection": 20000, "visits": 2})
check("FR-SR-02 sales entry saved", s == 200 and d.get("ok"), msg(d))
s, d = call("POST", "/sales/entries", sa, {"entry_date": today, "sales": 1})
check("TS-23 second entry opens existing", s == 200 and d.get("existing") and "opened for editing" in d["message"], msg(d))
s, tg = call("GET", f"/sales/targets?year={date.today().year}&month={date.today().month}", sup)
locked = tg["locks"][0]
s, d = call("POST", "/sales/entries", sa, {"entry_date": f"{locked['year']}-{locked['month']:02d}-10", "sales": 10})
check("TS-24 locked month refused", s == 409 and "locked or in the future" in str(d), str(d))
s, d = call("POST", "/sales/leads", sa, {"lead_date": today, "customer_name": "Lead QA", "expected_value": 90000, "stage": "Lost"})
check("TS-25 Lost without reason blocked", s == 422 and "reason this lead was lost" in str(d), str(d))
s, d = call("GET", "/sales/dashboard", sa)
check("TS-26 Sales Admin refused Sales Dashboard", s == 403 and d == "You do not have access to the Sales Dashboard.", str(d))
s, d = call("GET", "/sales/dashboard", pm)
check("FR-SD-01 Production Manager refused too", s == 403)
s, d = call("GET", f"/sales/entries?sales_admin_id=2", sa)
s2, own = call("GET", "/sales/entries", sa)
s3, other = call("GET", "/sales/entries", sa2)
check("FR-SR-04 own records only", {e["id"] for e in own}.isdisjoint({e["id"] for e in other}) and len(own) > 0)

# ---- Sales Dashboard maths (TS-27..30) ----
sys.path.insert(0, ".")
try:
    from app.routers.sales import achievement, status_for, weighted_score
    w = {"sales": 40, "collection": 25, "delivery": 20, "visits": 15}
    ach = {"sales": 9.73 / 40 * 100, "collection": 4.93 / 40 * 100, "delivery": 6.5 / 40 * 100, "visits": 4 / 40 * 100}
    sc = weighted_score(ach, w)
    check("TS-27 weighted score 18%, Critical", round(sc) == 18 and status_for(sc, {"on_track": 75, "watch": 50}) == "Critical", f"{sc:.2f}")
    sc2 = weighted_score({"sales": 80, "collection": 60, "delivery": 50, "visits": None}, w)
    check("TS-30 no-target measure dropped, weights rescaled", abs(sc2 - (80 * 40 + 60 * 25 + 50 * 20) / 85) < 1e-9 and achievement(5, 0) is None)
    check("BR-20 achievement capped at 100", weighted_score({"sales": 250, "collection": 100, "delivery": 100, "visits": 100}, w) == 100)
except ImportError as e:
    check("TS-27 unit import", False, str(e))

yr = date.today().year
s, q = call("GET", f"/sales/dashboard?mode=quarterly&year={yr}&period=1", sup)
tot = 0
for mth in (1, 2, 3):
    s, md = call("GET", f"/sales/dashboard?mode=monthly&year={yr}&period={mth}", sup)
    tot += md["summary"]["sales"]["actual"]
check("TS-28 quarter = sum of three months", abs(q["summary"]["sales"]["actual"] - tot) < 0.01, f"{q['summary']['sales']['actual']} vs {tot}")
check("TS-29 conversion never above 100", all((r.get("conversion") or 0) <= 100 for r in q["ranking"]) and (q["summary"]["conversion"].get("pct") or 0) <= 100)
ranks = [r["rank"] for r in q["ranking"]]
scores = [r.get("score", -1) for r in q["ranking"]]
check("BR-25 ranking sorted by score", ranks == sorted(ranks) and scores == sorted(scores, reverse=True), str(scores))

# ---- misc ----
s, d = call("POST", f"/orders/{order_id}/cancel", sup, {"reason": "test"})
check("FR-GD-03 delivered order cannot be cancelled", s == 409, str(d))
s, d = call("DELETE", f"/orders/{order_id}", sup)
check("BR-11 no delete endpoint for orders", s in (404, 405))
s, d = call("GET", "/users", pm)
check("RBAC users list Super Admin only", s == 403)
s, d = call("GET", "/audit", sup)
check("FR-GEN-02 audit log populated", s == 200 and len(d) > 30)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
