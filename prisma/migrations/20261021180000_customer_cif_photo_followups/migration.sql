-- CIF numbers (CIF-000124): one sequence, existing customers numbered in the order they were added.
CREATE SEQUENCE "cif_no_seq";
CREATE FUNCTION next_cif_no() RETURNS text LANGUAGE sql AS $$
  SELECT 'CIF-' || lpad(v::text, greatest(6, length(v::text)), '0') FROM nextval('cif_no_seq') AS v
$$;
ALTER TABLE "Customer" ADD COLUMN "cifNo" TEXT;
UPDATE "Customer" c SET "cifNo" = 'CIF-' || lpad(n.rn::text, greatest(6, length(n.rn::text)), '0')
FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn FROM "Customer") n WHERE n.id = c.id;
SELECT setval('cif_no_seq', greatest((SELECT count(*) FROM "Customer"), 1), (SELECT count(*) FROM "Customer") > 0);
ALTER TABLE "Customer" ALTER COLUMN "cifNo" SET DEFAULT next_cif_no(), ALTER COLUMN "cifNo" SET NOT NULL;
CREATE UNIQUE INDEX "Customer_tenantId_cifNo_key" ON "Customer"("tenantId", "cifNo");

-- Customer photo.
ALTER TABLE "Customer" ADD COLUMN "photoPath" TEXT;

-- General follow-up calls on a customer.
ALTER TABLE "Call" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Call" ADD CONSTRAINT "Call_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
