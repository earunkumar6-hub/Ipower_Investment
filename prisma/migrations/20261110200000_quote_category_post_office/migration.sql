-- Quotation products: one "Post office" instead of RD, TD, KVP, NSC, SCSS, MIS and PLI (owner, 10 Nov 2026). The scheme
-- is chosen as the Plan. The seven are switched off (not deleted), so old quotations keep their text and an Admin can
-- bring any back in Settings → Dropdown values. "Post office" is added for every agency that doesn't have it yet.
UPDATE "DropdownOption"
SET "active" = false
WHERE "list" = 'quotationCategory' AND "active" AND lower("value") IN ('rd', 'td', 'kvp', 'nsc', 'scss', 'mis', 'pli');

INSERT INTO "DropdownOption" ("id", "tenantId", "list", "value", "sort")
SELECT md5(random()::text || clock_timestamp()::text || t.id || 'quotationCategory' || 'Post office'), t.id, 'quotationCategory', 'Post office',
  COALESCE((SELECT MAX(d."sort") FROM "DropdownOption" d WHERE d."tenantId" = t.id AND d."list" = 'quotationCategory'), 0) + 1
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "DropdownOption" d WHERE d."tenantId" = t.id AND d."list" = 'quotationCategory' AND lower(d."value") = 'post office'
);
