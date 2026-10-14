"""Checks that the Super Admin has full access: acts in every role and can open any user's account.
Run against a running server:  python tests/test_super_admin.py [base_url]
"""
import sys
from datetime import date

sys.path.insert(0, "tests")
from test_flow import call, check, login, results, upload_png  # noqa: E402  (runs the main flow first)

print("\n--- Super Admin full access ---")
sup = login("superadmin")
s, users = call("GET", "/users", sup)
by_login = {u["login_id"]: u for u in users}
sales1 = by_login["sales1"]["id"]

_, img = upload_png(sup)
body = {"sales_admin_id": sales1, "customer": {"name": "Super Admin Test Customer"}, "place": True,
        "items": [{"product_code": "130001", "height": 18, "width": 40, "length": 24, "colour_code": "CL-208",
                   "wood_category": "Mahogany", "seasoning": "Seasonal", "amount": 42000, "images": [img["file"]]}]}
s, d = call("POST", "/orders", sup, {**body, "sales_admin_id": None})
check("SA order needs a chosen Sales Admin", s == 422, str(d))
s, d = call("POST", "/orders", sup, body)
check("SA places an order for a Sales Admin", s == 200 and d["status"] == "Pending", str(d))
oid = d["id"]
s, od = call("GET", f"/orders/{oid}", sup)
check("order belongs to the chosen Sales Admin", od["sales_admin"] == by_login["sales1"]["name"])
item = od["items"][0]["id"]
s, meta = call("GET", "/meta", sup)
site = next(x["id"] for x in meta["sites"] if x["code"] == "PS-04")
s, d = call("POST", f"/items/{item}/assign", sup, {"site_id": site})
check("SA assigns a site", s == 200, str(d))
s, d = call("POST", f"/items/{item}/no-requisition", sup, {"remark": "Stock available"})
check("SA confirms no requisition (APM action)", s == 200, str(d))
s, d = call("POST", f"/items/{item}/move", sup, {"to": "Machine Room"})
check("SA moves a stage (APM action)", s == 200 and d["item"]["stage"] == "Machine Room", str(d))
check("SA sees allowed moves", bool(d["item"].get("moves")))
s, d = call("POST", "/store-requisitions", sup, {"item_id": item, "lines": [{"material_code": "3010012", "quantity": 2}]})
check("SA submits a store requisition", s == 200, str(d))
s, inbox = call("GET", "/store-requisitions?status=Submitted", sup)
rid = next(r["id"] for r in inbox if r["item_id"] == item)
s, d = call("POST", f"/store-requisitions/{rid}/process", sup, {"action": "issue"})
check("SA issues a requisition (Store action)", s == 200, str(d))
s, d = call("POST", f"/cost/items/{item}/lines", sup, {"name": "Timber", "rate": 1000, "per": "Pcs", "amount": 5000})
check("SA enters a production cost", s == 200, str(d))
s, d = call("POST", "/sales/entries", sup, {"sales_admin_id": sales1, "entry_date": date.today().isoformat(), "sales": 1000, "visits": 1})
check("SA records a sales entry for a Sales Admin", s == 200, str(d))
s, d = call("POST", "/sales/leads", sup, {"sales_admin_id": sales1, "lead_date": date.today().isoformat(),
                                          "customer_name": "SA Lead", "expected_value": 1000, "stage": "New"})
check("SA adds a lead for a Sales Admin", s == 200, str(d))
s, d = call("GET", "/dashboard/sales-admin", sup)
check("SA opens the order dashboard (all branches)", s == 200 and d["cards"]["total_orders"] >= 1, str(d)[:120])
s, d = call("GET", "/badges", sup)
check("SA badges cover every inbox", s == 200, str(d))

s, d = call("POST", f"/users/{by_login['apm02']['id']}/impersonate", sup)
check("SA signs in as another user", s == 200 and d["user"]["login_id"] == "apm02", str(d)[:120])
tok = d["token"]
s, me = call("GET", "/auth/me", tok)
check("impersonated session acts as that user", me["user"]["role"] == "Assistant Production Manager")
s, logs = call("GET", "/audit?action=IMPERSONATE", sup)
check("impersonation is in the audit log", len(logs) >= 1)
pm = login("pm")
s, d = call("POST", f"/users/{by_login['sales2']['id']}/impersonate", pm)
check("only the Super Admin can sign in as others", s == 403, str(d))

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed (all checks)")
sys.exit(1 if failed else 0)
