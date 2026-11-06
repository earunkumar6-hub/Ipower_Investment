-- Tickets (/tickets): problems, new feature requests and questions raised by staff.

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('High', 'Medium', 'Low');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('Problem', 'NewFeature', 'Question');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('Open', 'InProgress', 'WaitingForYou', 'Fixed', 'Closed');

-- AlterEnum
ALTER TYPE "AttachmentOwner" ADD VALUE 'Ticket';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "ticketAlertEmail" TEXT,
ADD COLUMN     "ticketAlertMobile" TEXT;

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "type" "TicketType" NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "details" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'Open',
    "targetDate" DATE NOT NULL,
    "raisedById" TEXT NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT,
    "statusFrom" "TicketStatus",
    "statusTo" "TicketStatus",
    "change" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ticket_tenantId_status_idx" ON "Ticket"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_tenantId_ticketNo_key" ON "Ticket"("tenantId", "ticketNo");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_idx" ON "TicketComment"("ticketId");

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- File types for ticket attachments (Settings → Dropdown values), for existing agencies.
INSERT INTO "DropdownOption" ("id", "tenantId", "list", "value", "sort")
SELECT md5(random()::text || clock_timestamp()::text || t.id || o.value), t.id, 'attachmentTicket', o.value, o.sort
FROM "Tenant" t CROSS JOIN (VALUES ('Screenshot', 1), ('Error message', 2)) AS o(value, sort);
