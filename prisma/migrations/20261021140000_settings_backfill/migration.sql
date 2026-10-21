-- Default accounts: the first cash account and the first bank account of each tenant (what cashAndBank() used before).
UPDATE "Account" a SET "isDefault" = true
FROM (SELECT DISTINCT ON ("tenantId", "type") id FROM "Account" WHERE "type" IN ('Cash', 'Bank') ORDER BY "tenantId", "type", "name", id) f
WHERE a.id = f.id;

-- Expense purposes (Settings → Expense purposes). "Salary" becomes "Staff salary"; old expenses keep their text.
INSERT INTO "DropdownOption" ("id", "tenantId", "list", "value", "sort")
SELECT md5(random()::text || clock_timestamp()::text || t.id || o.value), t.id, 'expensePurpose', o.value, o.sort
FROM "Tenant" t CROSS JOIN (VALUES
  ('Stationery', 1), ('Rent', 2), ('Utilities', 3), ('Travel', 4), ('Repairs', 5), ('Equipment', 6), ('Office', 7),
  ('Staff salary', 8), ('Marketing', 9), ('Pooja', 10), ('Customer incentives', 11), ('Bank charges', 12)
) AS o(value, sort);
