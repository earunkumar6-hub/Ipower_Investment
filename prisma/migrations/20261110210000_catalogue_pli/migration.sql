-- Products catalogue: add Postal Life Insurance (PLI) for every agency that doesn't have it (owner, 10 Nov 2026). It was
-- only in the demo seed, so installed agencies couldn't pick it in the quotation Plan list. Same settings as the seed:
-- life insurance sold by the post office, all four pay modes, 3-year lock-in, bank details, term per policy (open-ended
-- schemes). An agency that already has a "Post Office" / "Postal Life Insurance" product keeps its own, untouched.
INSERT INTO "Product" ("id", "tenantId", "name", "productType", "partner", "invoiceRule", "payModes", "lockInMonths",
  "bankDetailsRequired", "bankFields", "prematureClosure", "fields", "requiredFields", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || t.id || 'Postal Life Insurance'), t.id, 'Postal Life Insurance', 'Insurance', 'Post Office', 'UntilPremiumTerm',
  ARRAY['Yearly', 'HalfYearly', 'Quarterly', 'Monthly']::"Frequency"[], 36,
  true, ARRAY['holder', 'bank', 'branch', 'ifsc', 'accountNo'], true,
  ARRAY['policyNumber', 'commencement', 'maturity', 'premiumPayingTerm', 'nominee'], ARRAY['policyNumber', 'commencement', 'premiumPayingTerm'], CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Product" p WHERE p."tenantId" = t.id AND p."partner" = 'Post Office' AND p."name" = 'Postal Life Insurance'
);

-- Its plans, only for a PLI product that has none yet (the one just added).
INSERT INTO "Scheme" ("id", "productId", "name", "tenureMonths")
SELECT md5(random()::text || clock_timestamp()::text || p."id" || s.name), p."id", s.name, NULL
FROM "Product" p
CROSS JOIN (VALUES ('Santosh (Endowment)'), ('Suraksha (Whole life)'), ('Suvidha (Convertible whole life)'),
  ('Sumangal (Money back)'), ('Yugal Suraksha (Joint life)'), ('Bal Jeevan Bima (Children)')) AS s(name)
WHERE p."partner" = 'Post Office' AND p."name" = 'Postal Life Insurance'
  AND NOT EXISTS (SELECT 1 FROM "Scheme" x WHERE x."productId" = p."id");
