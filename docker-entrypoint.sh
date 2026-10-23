#!/bin/sh
# Apply migrations; fill an empty database on the first start only:
#   INSTALL_MODE=demo (default) → demo agency (reset for a rehearsal: docker compose exec app pnpm db:seed)
#   INSTALL_MODE=live           → company + owner login only (prisma/setup.ts); the demo seed is refused
set -e
pnpm exec prisma migrate deploy
if [ "$(node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().tenant.count().then(n=>{console.log(n);process.exit(0)})")" = "0" ]; then
  if [ "$INSTALL_MODE" = "live" ]; then
    echo "Empty database: live setup (owner login, no demo data)"
    pnpm db:setup
  else
    echo "Empty database: seeding demo data"
    pnpm db:seed
  fi
fi
exec pnpm start -H 0.0.0.0 -p 3000
