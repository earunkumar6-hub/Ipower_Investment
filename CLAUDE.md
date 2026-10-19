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
- P&L income = E-Sevai service charges + Other income (Day Book entry type `OtherIncome`, Admin/Super Admin, with a reason). Commission is still recorded on receipts but shown and counted nowhere (owner decision 19 Oct 2026).
- Post office schemes: RD, TD, MIS, SCSS, SSA, PPF, NSC, KVP. RD monthly and SSA/PPF yearly are dues collected via Receipts; TD/MIS/SCSS/NSC/KVP are one-time, so Renewals shows a read-only maturity reminder (start + term), kept out of totals and the Day Book, closed with "Mark matured". Renewals filter: product → company (insurer/AMC) → scheme (`src/lib/renewals.ts`).
- Paid to company: Renewals Paid tab shows whether collected money reached the company. RD = PO deposit in the Day Book (unchanged); insurance, MF, SSA, PPF = tick receipts of one company → "Pay to company" (`CompanyPayment`, date + company receipt/UTR + cash/bank account, Day Book `PaidToCompany` money-out). A receipt paid to the company can't be cancelled. No undo yet. The same can be done for one receipt from its page ("Update deposit status": insurance/MF/SSA/PPF via `payToCompany`; RD via `depositOneRdReceipt`, a one-line PO deposit from cash or bank that skips the UPI vs ATM check). Status text, filter and "Collected by" (receipt `createdById`) / "· by <user>" (who recorded the deposit) come from `src/lib/deposit-status.ts`.
- EB bills ₹1,000–1,999 and ₹30,000+: refused with "rate not configured" (no placeholder rate).
- Excel/PDF export needs `Report.Export`; mobiles in exports stay masked.
- Settings → Products and schemes (`Settings.Edit`, Admin + Super Admin): products with bill rule, pay modes, lock-in, bank fields, premature closure, shown/required fields, custom fields; schemes with tenure and rate history (`rateOn`, `src/lib/products.ts`). Policies link via `productId`/`schemeId` (null for older ones).
- Policy closure: "Close early" (date + reason, refused inside lock-in or if the product forbids it) or MF "Withdraw" (date) → status PrematureClosed/Withdrawn, unpaid instalments → `Stopped`, no Day Book money.
- Change log: `audit()` (`src/lib/audit.ts`) in the same transaction as the change; Settings → Change log (`Audit.View`). New modules should log their changes too.
- Leads: status is only Interested / Not interested (reason, closes calls) / Call back (needs a call); `stage` (Lead → Quotation → Proposal → Customer) moves forward only via `advanceStage` (`src/lib/leads.ts`). Required: first name, DOB, gender, ≥1 mobile, status, business type (`LeadSource`), referrer for Referral. All numbers live in `LeadMobile` (unique per tenant → duplicate check); `Lead.mobile`/`onWhatsApp` mirror the first. `name` = first + last.
- Calls (follow-ups) are about a lead, a renewal (`policyId`) or a proposal; renewal/proposal calls end with `Done`. Follow-ups screen and export share `loadFollowUps` (`src/lib/followups.ts`). Forms that need "Check before saving" use `useConfirmBeforeSave` (`src/components/confirm-save.tsx`).
- Quotations: each product has a decision (Selected → one proposal each / Not accepted); "Mark not accepted" needs a reason; delete is a soft delete (only while no proposal) and is logged. Image export = `htmlToPng` of the PDF HTML.
- Proposals hold the policy details (pay mode, term, start date, premium paying term, scheme…); `createPolicyWithSchedule` (`src/lib/policies.ts`) builds the policy and renewals for both issued proposals and "Add product directly". Renewals are the payments after the first and end before the term (Yearly × 3 years = 2). Direct proposals (no quotation) skip OTP consent/PAN (owner decision). Accounts keep `rateAtOpen`.
- Bank details are AES-256-GCM encrypted with `DATA_ENCRYPTION_KEY` (`src/lib/crypto.ts`); losing the key makes them unreadable.
- Attachments (quotation / proposal / customer) live in `storage/attachments`, served only by `/api/attachments/[id]` after the record's owner check; uploader or Admin removes (logged).
- Round-2 plan and owner decisions: `docs/changes_round2.json`.
- Letterhead (logo, company, tagline, "R. Murali, Financial Advisor") lives in `src/lib/brand.ts`. Logo = client file of 19 Oct 2026 (cropped, transparent, only ~224px – ask for a larger copy before print work).
- Colours follow the logo: `brand-*` = crimson (#D22229; buttons, links, '--primary'), `saffron-*` = saffron (#FAA618; selected menu item, highlights, notes), sidebar `brand-800`. Status badges keep their meaning colours. Don't use Tailwind blue/indigo for UI chrome.

## Tests – they write to the database in `DATABASE_URL`
- `pnpm test` (vitest) and `pnpm e2e` (Playwright, reseeds) use the dev DB from `.env`. Don't run them against real data.
- Use a scratch DB: `docker exec app-postgres-1 createdb -U flcrm flcrm_check`, set
  `DATABASE_URL=postgresql://flcrm:flcrm@localhost:5433/flcrm_check`, `pnpm prisma migrate deploy`, `pnpm db:seed`, `pnpm test`, then `dropdb`.
- Dev Postgres is on host port 5433. Seed tests that check month totals only run from the 10th of the month.
