-- Cash denomination on any Day Book cash line, and on expenses paid later from office cash.
ALTER TABLE "DayBookEntry" ADD COLUMN "denominations" JSONB;
ALTER TABLE "Expense" ADD COLUMN "denominations" JSONB;

-- Dropdown lists with "Other" (Settings → Dropdown values): quotation products and file types.
INSERT INTO "DropdownOption" ("id", "tenantId", "list", "value", "sort")
SELECT md5(random()::text || clock_timestamp()::text || t.id || o.list || o.value), t.id, o.list, o.value, o.sort
FROM "Tenant" t CROSS JOIN (VALUES
  ('quotationCategory', 'Health', 1), ('quotationCategory', 'Life', 2), ('quotationCategory', 'Motor', 3), ('quotationCategory', 'Personal accident', 4),
  ('attachmentQuotation', 'Health declaration', 1), ('attachmentQuotation', 'Brochure', 2),
  ('attachmentProposal', 'Aadhaar', 1), ('attachmentProposal', 'PAN', 2), ('attachmentProposal', 'Photo', 3), ('attachmentProposal', 'Proposal form', 4),
  ('attachmentCustomer', 'Aadhaar', 1), ('attachmentCustomer', 'PAN', 2), ('attachmentCustomer', 'Policy document', 3), ('attachmentCustomer', 'Bank passbook', 4)
) AS o(list, value, sort);
