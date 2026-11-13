-- QA D-06, second part (13 Nov 2026): the other columns that hold a user id become foreign keys to "User" too.
-- NOT VALID first, then validated where the data allows (a notice otherwise), so an install with an old stray row still migrates.
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BillGroup" ADD CONSTRAINT "BillGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BillGroupMember" ADD CONSTRAINT "BillGroupMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Call" ADD CONSTRAINT "Call_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CommissionReceipt" ADD CONSTRAINT "CommissionReceipt_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CommissionReceipt" ADD CONSTRAINT "CommissionReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CompanyPayment" ADD CONSTRAINT "CompanyPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CompanyPayment" ADD CONSTRAINT "CompanyPayment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_consentById_fkey" FOREIGN KEY ("consentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DayBookEntry" ADD CONSTRAINT "DayBookEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DirectBill" ADD CONSTRAINT "DirectBill_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DirectBill" ADD CONSTRAINT "DirectBill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DropdownOption" ADD CONSTRAINT "DropdownOption_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OwnerEntry" ADD CONSTRAINT "OwnerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OwnerEntry" ADD CONSTRAINT "OwnerEntry_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OwnerPaidSlip" ADD CONSTRAINT "OwnerPaidSlip_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OwnerPaidSlip" ADD CONSTRAINT "OwnerPaidSlip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PoDeposit" ADD CONSTRAINT "PoDeposit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PoDeposit" ADD CONSTRAINT "PoDeposit_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_consentById_fkey" FOREIGN KEY ("consentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SchemeRate" ADD CONSTRAINT "SchemeRate_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ServiceTransaction" ADD CONSTRAINT "ServiceTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['Attachment.Attachment_uploadedById_fkey',
      'BillGroup.BillGroup_createdById_fkey',
      'BillGroupMember.BillGroupMember_addedById_fkey',
      'Call.Call_ownerId_fkey',
      'CommissionReceipt.CommissionReceipt_cancelledById_fkey',
      'CommissionReceipt.CommissionReceipt_createdById_fkey',
      'CompanyPayment.CompanyPayment_createdById_fkey',
      'CompanyPayment.CompanyPayment_verifiedById_fkey',
      'Customer.Customer_consentById_fkey',
      'DayBookEntry.DayBookEntry_createdById_fkey',
      'DayClose.DayClose_closedById_fkey',
      'DayClose.DayClose_verifiedById_fkey',
      'DirectBill.DirectBill_cancelledById_fkey',
      'DirectBill.DirectBill_createdById_fkey',
      'DropdownOption.DropdownOption_createdById_fkey',
      'Expense.Expense_approvedById_fkey',
      'MessageLog.MessageLog_createdById_fkey',
      'OwnerEntry.OwnerEntry_createdById_fkey',
      'OwnerEntry.OwnerEntry_decidedById_fkey',
      'OwnerPaidSlip.OwnerPaidSlip_confirmedById_fkey',
      'OwnerPaidSlip.OwnerPaidSlip_createdById_fkey',
      'Payment.Payment_cancelledById_fkey',
      'Payment.Payment_createdById_fkey',
      'PoDeposit.PoDeposit_createdById_fkey',
      'PoDeposit.PoDeposit_verifiedById_fkey',
      'Proposal.Proposal_consentById_fkey',
      'Proposal.Proposal_ownerId_fkey',
      'Quotation.Quotation_deletedById_fkey',
      'Quotation.Quotation_ownerId_fkey',
      'Quotation.Quotation_sentById_fkey',
      'Receipt.Receipt_cancelledById_fkey',
      'RolePermission.RolePermission_updatedById_fkey',
      'SchemeRate.SchemeRate_changedById_fkey',
      'ServiceTransaction.ServiceTransaction_createdById_fkey',
      'Ticket.Ticket_closedById_fkey'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', split_part(c, '.', 1), split_part(c, '.', 2));
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'Kept % NOT VALID: some existing rows point at a user that no longer exists', c;
    END;
  END LOOP;
END $$;
