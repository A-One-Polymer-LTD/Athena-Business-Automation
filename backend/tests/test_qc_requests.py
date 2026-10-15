"""QC requests (Workflow F): send to a chosen reviewer, reject with feedback, resend as a new round, approve.
Run against a running server with fresh sample data:  python tests/test_qc_requests.py [base_url]
"""
import json, time, urllib.request
import sys
B = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000") + "/api"
for _ in range(40):
    try:
        urllib.request.urlopen(B + "/health"); break
    except Exception:
        time.sleep(1)


def call(m, p, t=None, b=None):
    h = {"Content-Type": "application/json"}
    if t: h["Authorization"] = "Bearer " + t
    r = urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers=h)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"null")


ok = []
def check(name, cond, info=""):
    cond = bool(cond)
    ok.append(cond); print(("PASS " if cond else "FAIL ") + name, "" if cond else str(info)[:300])

T = {u: call("POST", "/auth/login", b={"login_id": u, "password": "Athena@123"})[1]["token"] for u in ["apm01", "pm", "superadmin", "apm02", "sales1"]}
# pre-existing items at QC stages get a request sent to their site APM
s, mine = call("GET", "/qc-requests?scope=assigned", T["apm01"])
check("existing QC items appear as requests for the site APM", s == 200 and len(mine) >= 1, mine)
print("   apm01 assigned:", [(r["request_no"], r["stage"], r["item_no"], r["submitted_by"], "->", r["reviewer"]) for r in mine])
# send an item at Carpenter to Carpenter QC, addressed to the PM
_, items = call("GET", "/items", T["apm01"])
it = next(i for i in items if i["stage"] == "Carpenter")
s, revs = call("GET", f"/items/{it['id']}/qc-reviewers", T["apm01"])
check("reviewer list starts with the site APM", s == 200 and revs[0].get("hint") == "APM of this site", revs)
pm = next(r for r in revs if r["role"] == "Production Manager")
s, d = call("POST", f"/items/{it['id']}/move", T["apm01"], {"to": "Carpenter QC", "reviewer_id": pm["id"], "note": "Ready for check"})
check("APM sends to Carpenter QC addressed to the PM", s == 200, d)
s, pmq = call("GET", "/qc-requests?scope=assigned", T["pm"])
req = next((r for r in pmq if r["item_id"] == it["id"]), None)
check("PM receives the QC request with details", req and req["reviewer"] == pm["name"] and req["submitted_by"] and req["open_checks"], pmq)
s, sent = call("GET", "/qc-requests?scope=sent", T["apm01"])
check("APM sees it under Sent by me", any(r["id"] == req["id"] for r in sent), sent)
s, d = call("POST", f"/qc-requests/{req['id']}/approve", T["apm01"], {})
check("the APM (not the reviewer) cannot approve", s == 403, d)
s, d = call("POST", f"/items/{it['id']}/qc/result", T["apm01"], {"check": "carp_before", "result": "Pass"})
check("the APM cannot record results on a request sent to the PM", s == 403, d)
s, d = call("POST", f"/qc-requests/{req['id']}/reject", T["pm"], {"check": "carp_final", "note": "Joint gap 2 mm"})
check("PM rejects with feedback; item back to Carpenter", s == 200, d)
_, item = call("GET", f"/items/{it['id']}", T["apm01"])
check("item returned to Carpenter", item["stage"] == "Carpenter", item["stage"])
trk = item["qc_tracker"][0]
check("tracker shows Rejected with feedback", trk["status"] == "Rejected" and trk["requests"][-1]["feedback"] == "Joint gap 2 mm", trk)
s, d = call("POST", f"/items/{it['id']}/move", T["apm01"], {"to": "Carpenter QC"})
_, item = call("GET", f"/items/{it['id']}", T["apm01"])
r2 = item["qc_tracker"][0]["requests"][-1]
check("resend creates round 2 to the site APM by default", r2["round"] == 2 and r2["status"] == "Pending", r2)
s, d = call("POST", f"/qc-requests/{r2['id']}/reassign", T["apm01"], {"reviewer_id": pm["id"], "reason": "PM to check"})
check("reassign to PM", s == 200, d)
s, d = call("POST", f"/qc-requests/{r2['id']}/approve", T["pm"], {"note": "Fixed"})
check("PM approves round 2", s == 200 and "approved" in d["message"], d)
_, item = call("GET", f"/items/{it['id']}", T["apm01"])
trk = item["qc_tracker"][0]
check("tracker Approved with next action", trk["status"] == "Approved" and "Lacquer" in trk["requests"][-1].get("next_action", ""), trk)
check("Move to Lacquer now enabled", any(m["to"] == "Lacquer" and m["enabled"] for m in item["moves"]), item["moves"])
s, d = call("GET", "/qc-requests?scope=all", T["sales1"])
check("Sales Admin cannot open QC requests", s == 403, d)
s, b = call("GET", "/badges", T["pm"]); print("   pm badges", b)
print(f"{sum(ok)} passed, {len(ok) - sum(ok)} failed")
sys.exit(0 if all(ok) else 1)
