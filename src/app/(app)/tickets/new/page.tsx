import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { TICKET_SCREENS } from "@/lib/tickets";
import { TicketForm } from "./ticket-form";

export default async function NewTicketPage() {
  const user = await requirePermission("Ticket.Create");
  return (
    <>
      <PageHeader title="Tickets" user={user} />
      <TicketForm screens={TICKET_SCREENS} />
    </>
  );
}
