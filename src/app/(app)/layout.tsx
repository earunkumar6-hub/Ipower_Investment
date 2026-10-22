import { AppSidebar } from "@/components/app-sidebar";
import { CallReminder } from "@/components/call-reminder";
import { SessionKeepAlive } from "@/components/session-keepalive";
import { openCalls } from "@/lib/leads";
import { MENU } from "@/lib/menu";
import { hasPermission, ROLE_LABEL } from "@/lib/permissions";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = MENU.filter((m) => !m.permission || hasPermission(user.role, m.permission));
  const calls = await openCalls(user);

  return (
    <div className="flex min-h-screen">
      <AppSidebar items={items} userName={user.name} roleLabel={ROLE_LABEL[user.role]} />
      <main className="min-w-0 flex-1 bg-slate-50 p-6">{children}</main>
      <CallReminder calls={calls} />
      <SessionKeepAlive />
    </div>
  );
}
