-- "Someone is editing this customer" ticket (QA D-02): see src/lib/customer-lock.ts.
CREATE TABLE "CustomerEditLock" (
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerEditLock_pkey" PRIMARY KEY ("customerId")
);

ALTER TABLE "CustomerEditLock" ADD CONSTRAINT "CustomerEditLock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerEditLock" ADD CONSTRAINT "CustomerEditLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
