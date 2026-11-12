-- Owner change list #35: quotation tabs Drafts / Sent / Converted. "Mark as sent" records when and by whom.
ALTER TABLE "Quotation" ADD COLUMN "sentAt" TIMESTAMP(3);
ALTER TABLE "Quotation" ADD COLUMN "sentById" TEXT;
