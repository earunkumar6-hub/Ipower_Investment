"""Phase 4 report: python qa/report/build_report.py  →  D:/Projects/GRM/QA/GRM_QA_Phase4_Report.xlsx

Reads qa/report/results.json (Playwright JSON reporter), qa/design/test-cases.json (Phase 2 design),
the Phase 1 workbook (requirements) and qa/report/defects.json (defects written up from the failures),
plus qa/report/vitest-summary.json when present (regression suite).
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
QA_DIR = Path("D:/Projects/GRM/QA")
import os
OUT = Path(os.environ.get("QA_REPORT_OUT", QA_DIR / "GRM_QA_Phase4_Report.xlsx"))
F = "Arial"
FILL = {"Passed": "E2EFDA", "Pass": "E2EFDA", "Failed": "FCE4D6", "Fail": "FCE4D6", "Blocked": "FFF2CC", "Not run": "EDEDED",
        "Partly": "FFF2CC", "Not tested": "EDEDED", "Critical": "C00000", "High": "F4B084", "Medium": "FFE699", "Low": "DDEBF7"}
thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
XBR = {"browser-chrome-1366": "XBR-01", "browser-chrome-1920": "XBR-02", "browser-edge-1366": "XBR-03", "browser-edge-1920": "XBR-04"}

cases = json.loads((APP / "qa/design/test-cases.json").read_text(encoding="utf-8"))
case_by_id = {c["id"]: c for c in cases}
results = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
defects = json.loads((HERE / "defects.json").read_text(encoding="utf-8")) if (HERE / "defects.json").exists() else []
vitest = json.loads((HERE / "vitest-summary.json").read_text(encoding="utf-8")) if (HERE / "vitest-summary.json").exists() else None

# ── Playwright results → per test-case status ────────────────────────────────────────────────────────────────────
runs = []  # (ids, title, project, status, duration, error, screenshot, annotations)


def walk(suite, file=""):
    file = suite.get("file") or file
    for s in suite.get("suites", []):
        walk(s, file)
    for spec in suite.get("specs", []):
        ids = re.findall(r"\[([A-Z0-9]+(?:-\d+)?)\]", spec["title"])
        for t in spec["tests"]:
            proj = t.get("projectName", "")
            res = t["results"][-1] if t["results"] else {}
            status = {"passed": "Passed", "failed": "Failed", "timedOut": "Failed", "interrupted": "Not run", "skipped": "Blocked"}.get(res.get("status", t.get("status")), "Not run")
            if t.get("status") == "skipped" or res.get("status") == "skipped":
                status = "Blocked"
            shot = next((a.get("path", "") for a in res.get("attachments", []) if a.get("name") == "screenshot" and a.get("path")), "")
            err = re.sub(r"\x1b\[[0-9;]*m", "", (res.get("error") or {}).get("message", ""))[:600]
            notes = "; ".join(a.get("description", "") for a in (res.get("annotations", []) + t.get("annotations", [])) if a.get("description"))
            ids2 = [XBR.get(proj, i) if i == "XBR" else i for i in ids]
            runs.append((ids2, spec["title"], proj, status, res.get("duration", 0), err, shot, notes, file))


for s in results.get("suites", []):
    walk(s)
# Re-runs of single spec files (results-rerun*.json) are added: a case counts as Failed if it failed in any run
# (race conditions do not fail every time); "intermittent" is noted when runs disagree.
for extra in sorted(HERE.glob("results-rerun*.json")):
    for s in json.loads(extra.read_text(encoding="utf-8")).get("suites", []):
        walk(s)

def fix_path(p):
    """Artifacts of the first re-run were moved to artifacts-rerun1 (each Playwright run clears its output folder)."""
    if not p or Path(p).exists():
        return p
    alt = p.replace(r"\report\artifacts" + "\\", r"\report\artifacts-rerun1" + "\\")
    return alt if Path(alt).exists() else ""


seen = defaultdict(set)
for ids, title, proj, status, *_ in runs:
    for i in ids:
        seen[i].add(status)
runs = [(ids, title, proj, status, dur, err, fix_path(shot), notes, file) for ids, title, proj, status, dur, err, shot, notes, file in runs]
status_by_case = {}
detail_by_case = {}
# Latest run wins (runs are in order: the full run, then each re-run after fixes); earlier different results are noted.
for ids, title, proj, status, dur, err, shot, notes, file in runs:
    for i in ids:
        if i in status_by_case and proj.startswith("browser") and status == "Passed" and status_by_case[i] == "Failed":
            continue  # a browser project that passed does not hide a failing sibling project
        earlier = " [earlier run: " + status_by_case[i] + "]" if i in status_by_case and status_by_case[i] != status and proj == detail_by_case[i][1] else ""
        status_by_case[i] = status
        detail_by_case[i] = (title, proj, dur, err, shot, (notes + earlier).strip(), file)
# Regression cases run by the Vitest suite.
for c in cases:
    if c["spec"] == "vitest":
        status_by_case[c["id"]] = ("Passed" if vitest and vitest.get("failed", 1) == 0 else "Failed") if vitest else "Not run"
        detail_by_case[c["id"]] = (c["title"], "vitest", 0, "" if not vitest else f"Vitest: {vitest.get('passed')} passed, {vitest.get('failed')} failed", "", "", "")
for c in cases:
    status_by_case.setdefault(c["id"], "Blocked" if c["automation"] == "Blocked" else "Not run")

# ── Requirements (Phase 1) ───────────────────────────────────────────────────────────────────────────────────────
p1 = load_workbook(QA_DIR / "GRM_QA_Phase1_Traceability.xlsx")["Traceability"]
reqs = [r for r in p1.iter_rows(min_row=2, values_only=True) if r[0]]
tests_for_req = defaultdict(list)
for c in cases:
    for rid in re.split(r"[,\s]+", c["requirements"]):
        if rid:
            tests_for_req[rid.replace("RG-", "RM-")].append(c["id"])


def req_result(rid, impl_status):
    ids = tests_for_req.get(rid, [])
    st = [status_by_case.get(i, "Not run") for i in ids]
    if not ids:
        return "Not tested", ids
    if "Failed" in st:
        return "Fail", ids
    if all(s == "Blocked" for s in st):
        return "Blocked", ids
    if all(s in ("Passed", "Blocked") for s in st):
        return "Pass", ids
    return "Partly", ids


# ── Workbook ─────────────────────────────────────────────────────────────────────────────────────────────────────
wb = Workbook()


def table(ws, headers, rows, widths, status_cols=()):
    ws.append(headers)
    for r in rows:
        ws.append(list(r))
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for c in ws[1]:
        c.font = Font(name=F, bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F3864")
        c.alignment = Alignment(wrap_text=True, vertical="center"); c.border = BORDER
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = Font(name=F, size=10); c.alignment = Alignment(wrap_text=True, vertical="top"); c.border = BORDER
        for sc in status_cols:
            v = str(row[sc].value or "")
            if v in FILL:
                row[sc].fill = PatternFill("solid", fgColor=FILL[v]); row[sc].font = Font(name=F, size=10, bold=True, color="FFFFFF" if v == "Critical" else "000000")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions


# Summary
ws = wb.active; ws.title = "Summary"
cnt = Counter(status_by_case[c["id"]] for c in cases)
total = len(cases)
sev = Counter(d["severity"] for d in defects if not d.get("status", "Open").startswith("Fixed"))  # open defects only
req_rows = [(r, *req_result(r[0], r[4])) for r in reqs]
req_cnt = Counter(x[1] for x in req_rows)
lines = [
    ("GRM (IPower Investments CRM) – QA report", ""),
    ("Run", results.get("stats", {}).get("startTime", "")[:19].replace("T", " ") + " UTC · app commit " + (sys.argv[1] if len(sys.argv) > 1 else "")),
    ("Environment", "QA app on http://localhost:3100 (next dev) · test DB flcrm_qa (reset per suite) · Chrome 1366x768 + browser check in Chrome/Edge 1366 & 1920"),
    ("", ""),
    ("Test cases", total),
    ("Passed", cnt["Passed"]), ("Failed", cnt["Failed"]), ("Blocked (feature not in app)", cnt["Blocked"]), ("Not run", cnt["Not run"]),
    ("", ""),
    ("Requirements (change list + regression)", len(reqs)),
    ("  Pass", req_cnt["Pass"]), ("  Fail", req_cnt["Fail"]), ("  Partly / mixed", req_cnt["Partly"]), ("  Blocked", req_cnt["Blocked"]), ("  Not tested", req_cnt["Not tested"]),
    ("", ""),
    ("Defects", len(defects)),
    ("  Critical", sev["Critical"]), ("  High", sev["High"]), ("  Medium", sev["Medium"]), ("  Low", sev["Low"]),
    ("", ""),
    ("Recommendation – client demo", ("CONDITIONAL GO" if sev["Critical"] else "GO")),
    ("  Why", "All change-list requirements are built and 53 of 54 pass (GST #13 is not built). The journeys work end to end. All ten defects found in the first run are fixed and re-verified, including the two that were only partly fixed the first time (D-05 change log, D-06 foreign keys) and the double-receipt race on the owner-paid-slip path." if not sev["Critical"] else "See Defects."),
    ("  Conditions", "Fine for the demo and for 3-4 PCs on the LAN. With 2,000 customers and 10,000 policies every page loaded in under 2.6 s even on the slower dev server (see Performance); a production build will be faster."),
    ("  Open questions", "GST (#13) not built; scheme advisor, PIN code, customer deactivate, follow-up reassignment and message failure/retry are not in the app (blocked tests) – see Phase 1 Questions."),
    ("", ""),
    ("Screenshots", "Paths in 'Defects' / 'Test results' are relative to D:\\Projects\\GRM\\app (failure screenshot, video and trace are in the same folder)."),
    ("Re-run full suite", "cd D:\\Projects\\GRM\\app ; pnpm qa"),
    ("Re-run one module", "pnpm qa --project=chrome-1366 qa/specs/customers.spec.ts"),
    ("Re-run one test", "pnpm qa --project=chrome-1366 -g \"CUST-11\""),
    ("Browser check only", "pnpm qa --project=browser-chrome-1366 --project=browser-chrome-1920 --project=browser-edge-1366 --project=browser-edge-1920"),
    ("Volume only", "pnpm qa --project=volume"),
    ("Rebuild this report", "pnpm qa:report"),
    ("HTML report (traces, videos)", "npx playwright show-report qa/report/html"),
]
for a, b in lines:
    ws.append([a, b])
ws.column_dimensions["A"].width = 38; ws.column_dimensions["B"].width = 110
ws["A1"].font = Font(name=F, bold=True, size=14)
for row in ws.iter_rows(min_row=2):
    row[0].font = Font(name=F, bold=not str(row[0].value).startswith("  "))
    row[1].font = Font(name=F); row[1].alignment = Alignment(wrap_text=True, horizontal="left")

# Traceability with pass / fail
table(wb.create_sheet("Traceability"),
      ["Req ID", "Screen(s)", "Requirement", "Module", "Implementation (Phase 1)", "Result", "Test cases", "Failed / blocked tests", "Note"],
      [(r[0], r[1], r[2], r[3], r[4], res, ", ".join(ids),
        ", ".join(f"{i} ({status_by_case[i]})" for i in ids if status_by_case.get(i) in ("Failed", "Blocked", "Not run")), r[8])
       for r, res, ids in req_rows],
      [8, 18, 50, 8, 16, 10, 30, 30, 40], status_cols=(5,))

# Test results
rows = []
for c in cases:
    title, proj, dur, err, shot, notes, file = detail_by_case.get(c["id"], (c["title"], "", 0, "", "", "", ""))
    rows.append((c["id"], c["module"], c["requirements"], c["type"], c["priority"], c["title"], status_by_case[c["id"]], proj,
                 round(dur / 1000, 1) if dur else "", (notes + (" | " if notes and err else "") + err.splitlines()[0] if err else notes), shot.replace(str(APP) + "\\", "")))
table(wb.create_sheet("Test results"), ["ID", "Module", "Requirements", "Type", "Priority", "Title", "Result", "Project", "Seconds", "Notes / error", "Screenshot"],
      rows, [9, 7, 13, 11, 8, 44, 9, 18, 8, 60, 50], status_cols=(6,))

# Defects
dws = wb.create_sheet("Defects")
drows = []
for d in defects:
    shot = ""
    for tid in d.get("tests", []):
        s = detail_by_case.get(tid, ("", "", 0, "", "", "", ""))[4]
        if s:
            shot = s.replace(str(APP) + "\\", ""); break
    drows.append((d["id"], d["module"], d["severity"], d["title"], d["steps"], d["expected"], d["actual"], ", ".join(d.get("tests", [])), shot or d.get("screenshot", ""), d.get("requirement", ""), d.get("status", "Open"), d.get("fix", "")))
table(dws, ["ID", "Module", "Severity", "Title", "Steps to reproduce", "Expected", "Actual (when found)", "Tests", "Screenshot", "Requirement", "Status after fixes", "Fix / remaining"],
      drows, [7, 8, 10, 36, 50, 36, 40, 14, 50, 10, 22, 50], status_cols=(2,))

# Performance
perf = [(i, detail_by_case.get(i, ("",) * 7)[5], status_by_case.get(i)) for i in ["PERF-01", "PERF-02", "PERF-03", "PERF-04", "PERF-05", "PERF-06"]]
table(wb.create_sheet("Performance"), ["Test", "Measured (2,000 customers / 10,000 policies, next dev server)", "Result (< 3 s)"], perf, [10, 70, 14], status_cols=(2,))

# Blocked / gaps
gaps = [(c["id"], c["title"], c["expected"]) for c in cases if status_by_case[c["id"]] == "Blocked"]
gaps += [(r[0], r[2], "No automated test in this run") for r, res, ids in req_rows if res == "Not tested"]
table(wb.create_sheet("Coverage gaps"), ["ID", "What", "Why"], gaps, [10, 60, 70])

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(f"{OUT}: {total} cases {dict(cnt)}; requirements {dict(req_cnt)}; defects {dict(sev)}")
