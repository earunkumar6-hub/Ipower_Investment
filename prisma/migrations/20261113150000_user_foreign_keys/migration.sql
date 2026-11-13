-- QA D-06 (13 Nov 2026): owner / created-by / raised-by / audit user columns become foreign keys to "User".
-- Added NOT VALID first so the migration never fails on an install that has an old row pointing at a missing user:
-- new and changed rows are checked at once; existing rows are then validated where possible (a notice otherwise).
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['Customer.Customer_ownerId_fkey', 'Lead.Lead_ownerId_fkey', 'Policy.Policy_ownerId_fkey', 'Receipt.Receipt_createdById_fkey',
                           'Ticket.Ticket_raisedById_fkey', 'AuditLog.AuditLog_userId_fkey', 'Expense.Expense_createdById_fkey'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', split_part(c, '.', 1), split_part(c, '.', 2));
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'Kept % NOT VALID: some existing rows point at a user that no longer exists', c;
    END;
  END LOOP;
END $$;
