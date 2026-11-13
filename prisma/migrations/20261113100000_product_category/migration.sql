-- Owner change list #12 (13 Nov 2026): quotation products come from Settings → Products and schemes.
-- Each product gets a category; the four starting ones follow the old quotation list. More can be added later.
ALTER TABLE "Product" ADD COLUMN "category" TEXT;

UPDATE "Product" SET "category" = CASE
  WHEN "productType" = 'MutualFund' THEN 'Mutual fund'
  WHEN "productType"::text LIKE 'Po%' OR lower(trim("partner")) = 'post office' THEN 'Post office'
  WHEN "invoiceRule" = 'UntilClosed' THEN 'Health insurance'
  ELSE 'Life insurance'
END;
