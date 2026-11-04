-- Quotation products: add "Mutual fund" for every agency that doesn't have it yet (owner, 3 Nov 2026).
-- A value an Admin removed (active = false) or a staff-typed "mutual fund" is left as it is.
INSERT INTO "DropdownOption" ("id", "tenantId", "list", "value", "sort")
SELECT md5(random()::text || clock_timestamp()::text || t.id || 'quotationCategory' || 'Mutual fund'), t.id, 'quotationCategory', 'Mutual fund',
  COALESCE((SELECT MAX(d."sort") FROM "DropdownOption" d WHERE d."tenantId" = t.id AND d."list" = 'quotationCategory'), 0) + 1
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "DropdownOption" d WHERE d."tenantId" = t.id AND d."list" = 'quotationCategory' AND lower(d."value") = 'mutual fund'
);
