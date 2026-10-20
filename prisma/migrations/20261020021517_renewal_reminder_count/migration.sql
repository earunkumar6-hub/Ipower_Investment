-- AlterTable
ALTER TABLE "RenewalItem" ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- Renewals that already had a reminder count it once
UPDATE "RenewalItem" SET "reminderCount" = 1 WHERE "lastReminderAt" IS NOT NULL;
