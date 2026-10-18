#!/bin/sh
# Apply migrations; seed the demo agency only on the first start (empty database).
# To reset for a rehearsal: docker compose exec app pnpm db:seed
set -e
pnpm exec prisma migrate deploy
if [ "$(node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().tenant.count().then(n=>{console.log(n);process.exit(0)})")" = "0" ]; then
  echo "Empty database: seeding demo data"
  pnpm db:seed
fi
exec pnpm start -H 0.0.0.0 -p 3000
