-- CreateEnum
CREATE TYPE "ServicePaidVia" AS ENUM ('Wallet', 'GPay', 'NetBanking');

-- AlterTable
ALTER TABLE "ServiceTransaction" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "denominations" JSONB,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paidVia" "ServicePaidVia" NOT NULL DEFAULT 'Wallet',
ADD COLUMN     "providerTxnNo" TEXT,
ADD COLUMN     "serviceName" TEXT;

-- AddForeignKey
ALTER TABLE "ServiceTransaction" ADD CONSTRAINT "ServiceTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: older wallets without a kind (EB wallet, PAN wallet…) become "Other" wallets, keeping names and balances.
UPDATE "Account" SET "walletKind" = 'Other' WHERE "type" = 'Wallet' AND "walletKind" IS NULL;

-- Data: an "Other" service type per tenant (name typed on each entry), defaulting to the first wallet.
INSERT INTO "ServiceType" ("id", "tenantId", "code", "name", "walletAccountId", "allowBankPay")
SELECT 'svc_other_' || t."id", t."id", 'OTHER', 'Other service',
       (SELECT a."id" FROM "Account" a WHERE a."tenantId" = t."id" AND a."type" = 'Wallet' ORDER BY a."walletKind" = 'CSC' DESC, a."name" LIMIT 1),
       true
FROM "Tenant" t
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."tenantId" = t."id" AND a."type" = 'Wallet')
  AND NOT EXISTS (SELECT 1 FROM "ServiceType" s WHERE s."tenantId" = t."id" AND s."code" = 'OTHER');

-- Data: link past entries to the customer whose main mobile matches.
UPDATE "ServiceTransaction" st SET "customerId" = (
  SELECT c."id" FROM "Customer" c WHERE c."tenantId" = st."tenantId" AND c."mobile" = st."customerMobile" ORDER BY c."createdAt" LIMIT 1
) WHERE st."customerMobile" IS NOT NULL AND st."customerId" IS NULL;
