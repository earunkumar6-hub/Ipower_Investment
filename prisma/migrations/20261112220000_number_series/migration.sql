-- Owner change list #36–38, #44: number series with one saved counter each, increased inside the same save, so a
-- number is never handed out twice and never reused after a cancellation. New records only – existing L- / RCPT- /
-- PAY- / BL- numbers are kept (they are already printed).
--   RR-01 leads · AA-01 receipts (a receipt for one bill, or one receipt for several bills) · IP-01 bills
CREATE TABLE "NumberCounter" (
  "tenantId" TEXT NOT NULL,
  "series"   TEXT NOT NULL,
  "value"    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "NumberCounter_pkey" PRIMARY KEY ("tenantId", "series")
);

-- Bills: IP-01, IP-02 … from their own sequence (the old BL- sequence is left unused).
CREATE SEQUENCE "ip_bill_no_seq";
CREATE OR REPLACE FUNCTION next_bill_no() RETURNS text LANGUAGE sql AS $$
  SELECT 'IP-' || lpad(v::text, greatest(2, length(v::text)), '0') FROM nextval('ip_bill_no_seq') AS v
$$;
