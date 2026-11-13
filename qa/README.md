# GRM QA suite (Playwright)

End-to-end tests for the IPower CRM, separate from `e2e/` (the demo script).

- **Test database only:** `flcrm_qa` on the dev Postgres (port 5433). `support/env.ts` refuses any database whose
  name does not end in `_qa`. The dev / demo database `flcrm` is never touched.
- **App under test:** a second dev server on port **3100** pointed at `flcrm_qa`. Playwright starts it
  (`webServer` in `playwright.config.ts`) or reuses one already running.
- **Data:** the seed script (`prisma/seed.ts`) is loaded at the start and **once per spec file** (`resetDb()` in
  `beforeAll`). Test logins are the seed users `superadmin`, `admin`, `arun`, `divya` (password in `prisma/seed.ts`).

## Run

```bash
pnpm qa                                                        # everything: modules, journeys, browsers, volume
pnpm qa --project=chrome-1366 qa/specs/customers.spec.ts      # one module
pnpm qa --project=chrome-1366 -g "CUST-11"                    # one test case
pnpm qa --project=volume                                       # 2,000 customers / 10,000 policies timings
pnpm qa:report                                                 # rebuild D:\Projects\GRM\QA\GRM_QA_Phase4_Report.xlsx
npx playwright show-report qa/report/html                     # HTML report with traces and videos
```

Edge projects need Microsoft Edge installed (`channel: "msedge"`).

## Layout

| Path | What |
|---|---|
| `design/cases.py` → `test-cases.json` | Phase 2 test design (IDs, steps, expected). Spec titles carry the IDs, e.g. `[CUST-11]`. |
| `pages/` | Page objects (login, app shell, customers, renewals, receipts, quotations, leads, tickets) |
| `specs/*.spec.ts` | One file per module + `security`, `concurrency`, `validation`, `reports`, `browser`, `volume` |
| `specs/journeys/` | J1 lead → policy → reminder → receipt → reports, J2 tickets, then data-integrity checks |
| `support/` | Test-DB guard, reset, fixtures (`loginAs`, `otherUser` for a second PC), SQL integrity checks |
| `report/` | `results.json`, HTML report, failure artifacts (screenshot, video, trace), `defects.json`, `build_report.py` |

Tests that need a feature the app does not have are `test.fixme` (reported as **Blocked**).
Failures are app defects unless noted in `report/defects.json`; application code is never changed to make a test pass.
