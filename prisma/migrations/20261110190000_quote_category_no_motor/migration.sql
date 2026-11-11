-- Quotation products: "Motor" is not required (owner, 10 Nov 2026). Switched off, not deleted: it leaves the Product list
-- on new quotations, old quotations keep the text, and an Admin can bring it back in Settings → Dropdown values.
UPDATE "DropdownOption"
SET "active" = false
WHERE "list" = 'quotationCategory' AND lower("value") = 'motor' AND "active";
