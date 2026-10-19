-- CreateTable
CREATE TABLE "CustomerMobile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "isWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerMobile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerMobile_tenantId_number_idx" ON "CustomerMobile"("tenantId", "number");

-- CreateIndex
CREATE INDEX "CustomerMobile_customerId_idx" ON "CustomerMobile"("customerId");

-- AddForeignKey
ALTER TABLE "CustomerMobile" ADD CONSTRAINT "CustomerMobile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing customers keep their one number
INSERT INTO "CustomerMobile" ("id", "tenantId", "customerId", "number", "isWhatsApp", "sort")
  SELECT 'cm_' || "id", "tenantId", "id", "mobile", false, 0 FROM "Customer";
