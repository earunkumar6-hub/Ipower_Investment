-- Quotation products: add the postal schemes RD, TD, KVP, NSC, SCSS, MIS and PLI for every agency that doesn't have
-- them yet (owner, 10 Nov 2026). A value an Admin removed (active = false) or a staff-typed one is left as it is.
INSERT INTO "DropdownOption" ("id", "tenantId", "list", "value", "sort")
SELECT md5(random()::text || clock_timestamp()::text || t.id || 'quotationCategory' || v.value), t.id, 'quotationCategory', v.value,
  COALESCE((SELECT MAX(d."sort") FROM "DropdownOption" d WHERE d."tenantId" = t.id AND d."list" = 'quotationCategory'), 0) + v.n
FROM "Tenant" t
CROSS JOIN (VALUES ('RD', 1), ('TD', 2), ('KVP', 3), ('NSC', 4), ('SCSS', 5), ('MIS', 6), ('PLI', 7)) AS v(value, n)
WHERE NOT EXISTS (
  SELECT 1 FROM "DropdownOption" d WHERE d."tenantId" = t.id AND d."list" = 'quotationCategory' AND lower(d."value") = lower(v.value)
);
