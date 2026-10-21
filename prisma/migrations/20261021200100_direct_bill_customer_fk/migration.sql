-- Undo the accidental change in 20261021200000_bill_groups: a direct bill keeps its old rule (customer link cleared, not blocked).
ALTER TABLE "DirectBill" DROP CONSTRAINT "DirectBill_customerId_fkey";
ALTER TABLE "DirectBill" ADD CONSTRAINT "DirectBill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
