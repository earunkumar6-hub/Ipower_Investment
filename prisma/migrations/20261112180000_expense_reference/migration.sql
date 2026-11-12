-- Owner change list #42: expenses get a transaction ID (UPI / net banking / card; cheque no. for cheque) and the bill
-- number becomes optional. The unique (tenant, vendor, bill no.) index stays: Postgres allows any number of blank (NULL) bills.
ALTER TABLE "Expense" ADD COLUMN "reference" TEXT;
ALTER TABLE "Expense" ALTER COLUMN "billNo" DROP NOT NULL;
