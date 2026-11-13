# IPower Investments 

**IPower Investments** is a small financial advisory agency. It helps families buy and look after
**insurance, mutual funds and post office savings schemes** (RD, TD, PPF, SSA and others), and it also
runs **e-seavi & CSC** counter services (electricity bill payments, PAN and certificate applications).

This software is the agency's **office system**. It replaces notebooks and spreadsheets with one place
where everything is written down once and every staff member sees the same, up-to-date picture.

**What it keeps track of**

- **Leads and follow-ups** – people who might become customers, and the phone calls to make (with a reminder pop-up).
- **Quotations and proposals** – the offers made to a customer, and the paperwork once they say yes.
- **Customers and their products** – who holds which policy or deposit, with Aadhaar / PAN kept safely (stored encrypted, shown masked).
- **Renewals** – which premium or instalment is due, which is overdue, which deposit is about to mature, and reminders to send.
- **Receipts and bills** – money received from customers (cash, UPI, net banking, cheque), numbered receipts as PDFs.
- **The Day Book** – a daily cash-and-bank ledger: every rupee in or out is one line that can never be edited, only reversed. At day's end the cash is counted, checked and the day is closed.
- **Expenses, ESEVAI & CSC entries, wallets and commission** – office spending (with approvals), the counter services, and what the agency earns.
- **Profit & Loss, reports and downloads** – month summaries and Excel / PDF downloads for the owner.
- **Tickets** – staff can report a problem or ask for a change; the developer is alerted.

**Who uses it** – three kinds of login: the **Super Admin** (the owner, sees everything including profit),
**Admins** (senior staff who approve and close the day) and **Users** (staff who add customers, take receipts and make calls).
The owner can change what each kind may do in Settings. Every change is recorded in a change log (who, what, when).

**Where it runs** – on an office computer, opened in a web browser (today on one PC, later shared by 3–4 PCs over the office network).
Nothing needs the internet once it is installed. WhatsApp / SMS messages are shown in a "Sent messages" list for now; nothing is really sent yet.

## Tech stack

A web application: staff open it in a browser, the server and the database run on an office PC.

| Part | Technology | What it does here |
|---|---|---|
| Web framework | **Next.js 15** (App Router, server actions) with **React 19** | Pages, forms and the server code in one project |
| Language | **TypeScript 5** | Catches mistakes before the app runs |
| Database | **PostgreSQL 16** (in Docker) | Stores all customers, money and the change log |
| Database access | **Prisma 6.19** | Tables, migrations, safe queries |
| Sign-in | **better-auth** (username + password) | Logins; sessions|
| Permissions | **CASL**, plus a Roles screen | What each role (Super Admin, Admin, User) may see and do |
| Screens and look | **Tailwind CSS 4**, **Base UI**, shadcn-style components, **lucide** icons, **sonner** pop-ups | Layout and controls; colours follow the IPower logo |
| Tables and charts | **TanStack Table 8**, **Recharts** | Lists and the dashboard charts |
| Forms and checks | **Zod 4** | Checks every form again on the server (mobile, PAN, Aadhaar, amounts) |
| Excel and PDF | **ExcelJS 4.4**, **Playwright / Chromium** | Excel downloads; receipts and reports as PDF |
| Security | AES-256-GCM encryption, keyed fingerprints | Aadhaar, PAN and bank details stored encrypted, shown masked |
| Packaging | **Docker Compose** (`pnpm demo:up`), **pnpm** | One-command start; installing and running |
| Tests | **Vitest** (294 unit tests), **Playwright** (`qa/` suite: 161 test cases, browser check in Chrome and Edge) | Automatic checking of the rules, screens and speed |

### Production-grade features

| Area | What is built in |
|---|---|
| **Data safety** | Aadhaar, PAN and bank details encrypted (AES-256-GCM) and shown masked; keyed fingerprints stop duplicates without storing the number in the clear |
| **Money integrity** | The Day Book is an append-only ledger (entries are reversed, never edited); closed days are locked; receipt / bill / lead numbers come from database counters, so there are no gaps or duplicates |
| **Concurrency** | Two staff cannot double-collect the same due (database advisory lock plus stale-screen check); an "editing ticket" (5-minute expiry, with Take over) plus a version check stops two people overwriting a customer record; no waiting, so no deadlocks |
| **Database rules** | Foreign keys on every user and record reference, unique constraints per agency, versioned migrations; all writes that belong together run in one transaction |
| **Access control** | Role-based permissions (Super Admin / Admin / User) with owner-editable overrides, checked on the server for every action; sign-in sessions expire after 1 hour |
| **Audit trail** | Every create, change, approval and delete is written to the change log (who, what, when) – guarded by an automatic test so new features cannot skip it |
| **Input checks** | All forms re-validated on the server (Zod): mobile, PAN, Aadhaar with check digit, amounts, dates in dd/mm/yyyy |
| **Speed at volume** | Lists are paged (50 per page), totals computed in SQL, trigram search indexes; pages tested with thousands of rows (under 3 s on the dev server, faster with `pnpm build` + `pnpm start`) |
| **Deployment** | One-command Docker Compose, offline after first build (fonts and Chromium inside the image), runs on the office LAN |
| **Quality gates** | TypeScript, ESLint, 294 unit tests against a real database, and an independent Playwright QA suite on a separate database with a defect report |

Not yet production-ready: HTTPS (cookies are HTTP-only on the LAN), real WhatsApp / SMS / email sending, and automatic database backups – plan these before real business data goes in.

Versions are pinned on purpose: Prisma 6.19.3 (not 7 or 8), TanStack Table v8 and ExcelJS 4.4.0 –
newer major versions work differently. Messages (WhatsApp / SMS / email) are not connected to a real provider yet.

The rest of this file explains how to run it, and the `qa/` folder holds the automated test suite.

## How to run it (step by step)

You need once: **Docker Desktop** (it holds the database) and **Node.js with pnpm**. Open a terminal in the `app` folder.

**First time only**

1. Copy `.env.example` to `.env`, and in `.env` replace the two `change-me` values:
   `BETTER_AUTH_SECRET` with any long random text, and `DATA_ENCRYPTION_KEY` with a key made by this command:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Keep a safe copy of `DATA_ENCRYPTION_KEY`: without it, stored Aadhaar / PAN and bank details cannot be read.
2. Start Docker Desktop and wait until it says it is running.
3. Run these, one after the other:

   ```sh
   pnpm install      # downloads what the app needs
   pnpm db:up        # starts the database
   pnpm db:migrate   # creates the tables
   pnpm db:seed      # fills it with sample data (ERASES everything in the database – demo use only)
   ```

**Every day** (start Docker Desktop first)

```sh
pnpm db:up          # database on
pnpm dev            # app on  →  open http://localhost:3000 in Chrome or Edge
```

Stop the app with **Ctrl + C** in that terminal.

**Faster alternative** – the pages open much quicker (no waiting the first time you open each page):

```sh
pnpm build          # once, and again after any code change (a minute or two)
pnpm start          # app on  →  http://localhost:3000
```

**Sign in** with a sample login (password for all: `demo1234`):

| Username | Role | Can do |
|---|---|---|
| `superadmin` | Super Admin (owner) | everything, including Profit & Loss and Settings → Users |
| `admin` | Admin | approvals, closing the day, reports |
| `arun`, `divya` | User (staff) | customers, receipts, calls, expenses |

**Other PCs on the office network:** see "Open it from another PC on the office LAN" below.
**Start fresh before a demo:** `pnpm db:seed` (resets to today's sample data).
**Never run `pnpm db:seed` on real business data** – it wipes the database.
**After the PC restarts:** open Docker Desktop, then `pnpm db:up` and `pnpm dev` (or `pnpm start`) again.

The one-command Docker version (`pnpm demo:up`) is described next.

Spec: `../fl_crm_demo.json`, `../Requirement_Analysis/*.pdf`.

## Run the demo (Docker – one command)

Needs Docker Desktop running and `.env` with `BETTER_AUTH_SECRET` (copy `.env.example`).

```sh
pnpm demo:up        # = docker compose up -d --build  (first build needs internet, ~10 min)
                    # open http://localhost:3000
pnpm demo:reseed    # reset to a fresh demo day before each rehearsal
docker compose down # stop (data is kept in Docker volumes)
```

The first start migrates the database and seeds the demo agency. After the image is built
the demo runs fully offline (fonts and Chromium for PDFs are inside the image).

### Open it from another PC on the office LAN (optional)

1. Find this laptop's IP (`ipconfig`, e.g. `192.168.1.20`).
2. In `.env` set `BETTER_AUTH_URL="http://192.168.1.20:3000"`, then `pnpm demo:up`.
3. Allow inbound TCP 3000 in Windows Firewall for the local subnet only.
4. On the other PC open `http://192.168.1.20:3000`. Avoid guest Wi-Fi with client isolation.
5. Cookies stay non-secure (HTTP) until HTTPS is set up (e.g. with mkcert).

## Develop (hot reload)

```sh
pnpm install
pnpm db:up          # Postgres 16 only, in Docker, host port 5433
pnpm db:migrate     # apply schema
pnpm db:seed        # IPower Investments on today's date (re-run any time to reset)
pnpm dev            # http://localhost:3000
```

Copy `.env.example` to `.env` first if it doesn't exist (set `BETTER_AUTH_SECRET`).

Demo users (password `demo1234`): `arun`, `divya` (User), `admin` (Admin), `superadmin` (Super Admin).

## Rehearsing the demo

- Run `pnpm db:seed` before every rehearsal. It resets everything to today: yesterday closed, today open,
  Arun's overdue call due 30 minutes ago. There is no "reopen day" in the demo, so a closed day stays closed until you reseed.
- Don't run `pnpm test` while someone is using the app: the Day Book tests close and reopen today.

## End-to-end demo script

```sh
pnpm e2e    # reseeds, then runs demo steps 1–11 in three simultaneous browser sessions
            # (Arun, R. Murali, Owner) against http://localhost:3000 (set E2E_BASE_URL to change)
```

It leaves the app in the state the demo ends in (today closed). Run `pnpm demo:reseed` (Docker) or
`pnpm db:seed` (dev) afterwards. Report: `e2e-report/index.html`.

## Checks

```sh
pnpm db:seed && pnpm typecheck && pnpm lint && pnpm test   # tests expect a freshly seeded database and clean up after themselves
```

## Layout

- `prisma/schema.prisma` – demo schema (subset of full build)
- `prisma/seed.ts` – seed; all money goes through the Day Book library
- `src/lib/daybook.ts` – post / reverse / closed-day guard / balances
- `src/lib/posting.ts` – receipt, E-Sevai, expense, PO deposit → Day Book lines
- `src/lib/permissions.ts` – role → permission names (CASL)
