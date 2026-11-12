-- Owner change list #28: pay modes can be added, renamed and deleted in Settings.
-- A mode the agency adds has its own name and behaves like one of the built-in modes ("base");
-- the money record keeps the built-in mode plus the name shown to staff and printed.
ALTER TABLE "PaymentOption" ADD COLUMN "base" "PaymentMode";
ALTER TABLE "Receipt" ADD COLUMN "modeName" TEXT;
ALTER TABLE "Payment" ADD COLUMN "modeName" TEXT;
ALTER TABLE "DirectBill" ADD COLUMN "modeName" TEXT;
-- #29: the customer bank list is no longer offered (the bank name is typed). Old rows of kind Bank are kept, unused.
