import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { MESSAGE_TEMPLATE } from "@/lib/lists";
import { seesAll } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

/** The demo never sends anything: every WhatsApp / SMS / email is written here instead. */
export default async function MessagesPage() {
  const user = await requirePermission("Message.View");
  const messages = await db.messageLog.findMany({
    where: { tenantId: user.tenantId, ...(seesAll(user.role) ? {} : { createdById: user.id }) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const users = await db.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } });

  return (
    <>
      <PageHeader title="Sent messages" user={user} actions={<ExportButton report="messages" user={user} />} />
      <div className="rounded-xl border bg-white p-4">
        <p className="mb-3 rounded-lg bg-saffron-50 p-2 text-sm text-saffron-900">
          Messaging is mocked in this demo: nothing leaves the laptop. Each WhatsApp, SMS or email the full build would send is listed here.
        </p>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Time</TableHead><TableHead>Channel</TableHead><TableHead>To</TableHead><TableHead>Message</TableHead><TableHead>Text</TableHead><TableHead>By</TableHead><TableHead>Status</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {messages.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</TableCell>
                <TableCell>{m.channel}</TableCell>
                <TableCell>{m.to}</TableCell>
                <TableCell>{MESSAGE_TEMPLATE[m.template] ?? m.template}</TableCell>
                <TableCell className="max-w-xl whitespace-normal text-xs">{m.body}</TableCell>
                <TableCell>{users.find((u) => u.id === m.createdById)?.name ?? "System"}</TableCell>
                <TableCell><StatusBadge tone="slate">{m.status}</StatusBadge></TableCell>
              </TableRow>
            ))}
            {messages.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Nothing sent yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
