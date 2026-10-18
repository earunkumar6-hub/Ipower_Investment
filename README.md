# IPower Investments – Clickable Demo

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
