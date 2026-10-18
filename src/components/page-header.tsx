import { CallsBadge } from "@/components/call-reminder";
import { db } from "@/lib/db";
import { fmtDate, istToday } from "@/lib/dates";
import { ownerScope } from "@/lib/leads";
import { ROLE_LABEL } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

export async function PageHeader({ title, user, actions }: { title: string; user: SessionUser; actions?: React.ReactNode }) {
  const [tenant, openCalls] = await Promise.all([
    db.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } }),
    db.call.count({ where: { tenantId: user.tenantId, outcome: null, ...ownerScope(user) } }),
  ]);
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="text-xs text-muted-foreground">
          {tenant?.name} · {fmtDate(istToday())} · Signed in as {user.name} ({ROLE_LABEL[user.role]})
        </p>
      </div>
      <div className="flex items-center gap-2">
        <CallsBadge count={openCalls} />
        {actions}
      </div>
    </div>
  );
}
