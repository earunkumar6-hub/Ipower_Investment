# IPower Investments – Install on a client machine

The client gets ready-built Docker images. No source code, no Node.js and no internet are needed.

## Part A – Prepare the package (developer machine, in `app/`)

1. Build and verify:
   ```powershell
   pnpm demo:up      # builds image ipower-crm:1.1
   pnpm e2e          # must pass 11/11
   pnpm demo:reseed  # e2e leaves today closed
   ```
2. Export the images (about 5.3 GB together):
   ```powershell
   mkdir D:\IPower_package
   docker save -o D:\IPower_package\ipower-crm.tar ipower-crm:1.1
   docker save -o D:\IPower_package\postgres16.tar postgres:16-alpine
   ```
3. Copy into the same folder: `deploy\docker-compose.yml`, `deploy\.env.example`, `deploy\INSTALL.md`.
   Do **not** copy your own `app\.env`.
4. Put the folder on a USB drive or external SSD.

Package contents:
```
IPower_package\
  ipower-crm.tar
  postgres16.tar
  docker-compose.yml
  .env.example
  INSTALL.md
```

## Part B – Install (client machine)

### Requirements
- Windows 10/11 64-bit on an **Intel/AMD (x64)** CPU (ARM laptops and Apple Silicon Macs won't run this image)
- Virtualization enabled in BIOS, WSL2 and Docker Desktop installed
- 8 GB RAM or more, 15 GB free disk space
- Port 3000 free

### Steps
1. Copy `IPower_package` to the client PC, e.g. `C:\IPower`.
2. Start Docker Desktop and wait until it shows "Engine running".
3. Open PowerShell in `C:\IPower` and load the images:
   ```powershell
   docker load -i ipower-crm.tar
   docker load -i postgres16.tar
   ```
4. Create `.env`: copy `.env.example` to `.env`, then set a new secret. Generate one with:
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
   Paste the output as `BETTER_AUTH_SECRET="..."`. Run the command again and paste the new output as
   `DATA_ENCRYPTION_KEY="..."` (it encrypts customers' bank details). Keep a copy of `.env` somewhere safe:
   without this key, saved bank details can't be read.
5. Start:
   ```powershell
   docker compose up -d
   ```
   The first start creates the database and loads the demo data (about 30 seconds).
6. Open http://localhost:3000. Demo users (password `demo1234`): `arun`, `divya`, `admin`, `superadmin`.
7. Docker Desktop → Settings → General → tick **Start Docker Desktop when you sign in**. The app restarts by itself after a reboot.

### Open from other PCs on the office network (optional)
1. Find this PC's IP: `ipconfig` (e.g. `192.168.1.20`). Ideally give it a fixed IP in the router.
2. In `.env` set `BETTER_AUTH_URL="http://192.168.1.20:3000"`, then `docker compose up -d`.
3. Allow the port, in PowerShell **as Administrator**:
   ```powershell
   New-NetFirewallRule -DisplayName "IPower Investments 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet -Action Allow
   ```
4. On the other PC open `http://192.168.1.20:3000`.

## Everyday commands (in `C:\IPower`)

| Task | Command |
|---|---|
| Stop | `docker compose down` (data is kept) |
| Start | `docker compose up -d` |
| Reset demo to a fresh day | `docker compose exec app pnpm db:seed` |
| See logs | `docker compose logs -f app` |

## Updating to a new version
1. Developer sends a new `ipower-crm.tar` and `docker-compose.yml` (it names the image version, e.g. `ipower-crm:1.1`). Replace the old `docker-compose.yml`; keep your `.env`.
2. On the client:
   ```powershell
   docker load -i ipower-crm.tar
   docker compose up -d
   ```
   Database changes are applied automatically on start; existing data is kept.

## Backup
Data lives in two Docker volumes: `flcrm_pgdata` (database) and `flcrm_bills` (uploaded bill files).
```powershell
docker compose exec postgres pg_dump -U flcrm -Fc -f /tmp/flcrm.dump flcrm
docker compose cp postgres:/tmp/flcrm.dump .\flcrm.dump
docker compose cp app:/app/storage .\storage-backup
```

**Never run `docker compose down -v`** – `-v` deletes all data.
