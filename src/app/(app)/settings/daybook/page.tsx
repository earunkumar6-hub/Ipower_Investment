import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { GraceDaysForm } from "../list-forms";
import { SettingsTabs } from "../settings-tabs";

/** Settings → Day Book: how many days after a date it can still be closed by an Admin. */
export default async function DayBookSettingsPage() {
  const user = await requirePermission("Settings.Edit");
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="daybook" />
      <div className="max-w-xl space-y-3 rounded-xl border bg-white p-4">
        <GraceDaysForm value={tenant.dayCloseGraceDays} />
        <p className="text-xs text-muted-foreground">
          A day can be closed up to this many days later (default 3). After that it locks: only the Super Admin can close it, and the Admins get an alert.
          The lock and the alert start working with the Day Book update (next phases); this setting is saved now.
        </p>
      </div>
    </>
  );
}
