import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { userNames } from "@/lib/leads";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { CreateBillGroupForm } from "./group-forms";

/** Bill groups (#21): saved sets of policies / accounts across customers, billed and paid together. */
export default async function BillGroupsPage() {
  const user = await requirePermission("Receipt.View");
  const canManage = hasPermission(user.role, "BillGroup.Manage");
  const [groups, users] = await Promise.all([
    db.billGroup.findMany({
      where: { tenantId: user.tenantId },
      include: { members: { select: { policy: { select: { customerId: true } } } }, _count: { select: { payments: true } } },
      orderBy: { name: "asc" },
    }),
    userNames(user.tenantId),
  ]);
  return (
    <>
      <PageHeader title="Bill groups" user={user} actions={<Link href="/receipts?tab=family" className={buttonVariants({ variant: "outline" })}>Family grouped receipts</Link>} />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Group</TableHead><TableHead>Usually paid by</TableHead><TableHead className="text-right">Policies</TableHead><TableHead className="text-right">Customers</TableHead><TableHead className="text-right">Receipts</TableHead><TableHead>Created by</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell><Link href={`/receipts/groups/${g.id}`} className="text-brand-700 hover:underline">{g.name}</Link></TableCell>
                  <TableCell>{[g.contactName, g.contactMobile].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="text-right">{g.members.length}</TableCell>
                  <TableCell className="text-right">{new Set(g.members.map((m) => m.policy.customerId)).size}</TableCell>
                  <TableCell className="text-right">{g._count.payments}</TableCell>
                  <TableCell>{users.find((u) => u.id === g.createdById)?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {g.members.length > 0 && <Link href={`/receipts/new?groupId=${g.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>New receipt</Link>}
                  </TableCell>
                </TableRow>
              ))}
              {groups.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No bill groups yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            A group pays all its policies / accounts in one receipt, whoever the customers are. A policy can be in only one group.
            {!canManage && " Only Admin and Super Admin can create groups or change their policies."}
          </p>
        </div>
        {canManage && <div className="w-80 shrink-0"><CreateBillGroupForm /></div>}
      </div>
    </>
  );
}
