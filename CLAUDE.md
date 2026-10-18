# IPower Investments CRM

Next.js 15 + React 19 + Prisma 6 + Postgres. Company "IPower Investments" (originally specced as FL_CRM).
Pending change requests from the owner: `docs/Changes.txt`. Run/deploy steps: `README.md`, `deploy/INSTALL.md`.

## How to work here
- Plan first and confirm in chat before changing files; ask when a request is ambiguous.
- Make targeted changes; don't rewrite working code.
- Never touch `.env` or secrets without asking.

## Pinned on purpose
- Prisma 6.19.3 (not 7/8). TanStack Table v8 (v9 has a different API). exceljs 4.4.0.
- Forms submit with `submitKeepingValues` (`src/lib/form.ts`) so React 19 doesn't wipe input on validation errors.

## Business rules decided by the owner
- Day Book is the money ledger: every movement is an immutable entry, corrections are reversals, closed days accept nothing (`src/lib/daybook.ts`). Balances are summed from the first entry, so never post before the last closed day.
- Receipts: bill date (`receiptDate`) drives Day Book, FY, instalment paid-on and RD commission; transaction date (`txnDate`) is when the customer paid and is only stored/printed. Past dates allowed only after the last closed day.
- Several dues paid together → one `PAY-` Payment with one RCPT per due (RD deposit, commission, Day Book stay per RCPT); a single due stays a plain RCPT. Payable dues come from `src/lib/dues.ts`: oldest first, advance up to 12 months within the term; the server re-derives them from `{policyId, count}` and creates advance instalments (as Paid) only when paid. A payment is cancelled whole, never one RCPT of it, and not once an RD line is deposited.
- P&L income = E-Sevai service charges + insurer/mutual fund commission. Post office commission is recorded on RD receipts but is not income (P&L and dashboard).
- EB bills ₹1,000–1,999 and ₹30,000+: refused with "rate not configured" (no placeholder rate).
- Commission figures are hidden from Users (stripped server-side); P&L is Super Admin only; Excel/PDF export needs `Report.Export`; mobiles in exports stay masked.
- Letterhead (logo, company, tagline, "R. Murali, Financial Advisor") lives in `src/lib/brand.ts`.

## Tests – they write to the database in `DATABASE_URL`
- `pnpm test` (vitest) and `pnpm e2e` (Playwright, reseeds) use the dev DB from `.env`. Don't run them against real data.
- Use a scratch DB: `docker exec app-postgres-1 createdb -U flcrm flcrm_check`, set
  `DATABASE_URL=postgresql://flcrm:flcrm@localhost:5433/flcrm_check`, `pnpm prisma migrate deploy`, `pnpm db:seed`, `pnpm test`, then `dropdb`.
- Dev Postgres is on host port 5433. Seed tests that check month totals only run from the 10th of the month.
