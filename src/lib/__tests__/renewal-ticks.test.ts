// Renewals → Post office schemes: tick rows, send reminders to all ticked, combined receipt pre-ticked.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { presetCounts, type PolicyOption } from "@/lib/receipt-options";

type U = { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string };
const session = vi.hoisted(() => ({ user: null as null | U }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", async () => {
  const { hasPermission } = await import("@/lib/permissions");
  return {
    authorize: async (permission: Parameters<typeof hasPermission>[1]) => {
      if (!session.user) throw new Error("Not signed in");
      if (!hasPermission(session.user.role, permission)) throw new Error(`Not allowed: ${permission}`);
      return session.user;
    },
  };
});

const { sendRemindersBulk } = await import("@/app/(app)/renewals/actions");
const started = new Date();
let items: { id: string; reminderCount: number; lastReminderAt: Date | null }[] = [];

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  session.user = { id: u.id, name: u.name, username: "admin", role: u.role, tenantId: u.tenantId };
  items = await prisma.renewalItem.findMany({
    where: { tenantId: u.tenantId, status: { in: ["Due", "Overdue"] }, policy: { productType: "PoRd", status: "Active" } },
    select: { id: true, reminderCount: true, lastReminderAt: true }, take: 3,
  });
});

afterAll(async () => {
  for (const i of items) await prisma.renewalItem.update({ where: { id: i.id }, data: { reminderCount: i.reminderCount, lastReminderAt: i.lastReminderAt } });
  await prisma.messageLog.deleteMany({ where: { createdAt: { gte: started }, template: "renewal_reminder" } });
  await prisma.$disconnect();
});

describe("Ticked Post office rows", () => {
  it("one button sends the reminder to every ticked bill; a bill that is no longer due is skipped", async () => {
    expect(items.length).toBeGreaterThanOrEqual(2);
    const r = await sendRemindersBulk([...items.map((i) => i.id), "not-a-bill"], []);
    expect(r).toMatchObject({ ok: true, message: `${items.length} reminder(s) sent · 1 skipped` });
    const after = await prisma.renewalItem.findMany({ where: { id: { in: items.map((i) => i.id) } } });
    expect(after.every((a) => a.reminderCount === items.find((i) => i.id === a.id)!.reminderCount + 1)).toBe(true);
    expect(await prisma.messageLog.count({ where: { createdAt: { gte: started }, template: "renewal_reminder", relatedId: { in: items.map((i) => i.id) } } })).toBe(items.length);
  });

  it("the combined receipt opens with the ticked bills (and the older ones of the same account) ticked", () => {
    const due = (itemId: string | null) => ({ itemId, billNo: null, label: "", date: "", amount: "500.00", tag: "Due" as const });
    const policies: PolicyOption[] = [
      { id: "a", label: "", customer: "", dues: [due("a1"), due("a2"), due("a3")] },
      { id: "b", label: "", customer: "", dues: [due("b1")] },
      { id: "c", label: "", customer: "", dues: [due("c1")] },
    ];
    expect(presetCounts(policies, ["a2", "b1"])).toEqual({ a: 2, b: 1 });
  });
});
