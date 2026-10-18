// "Send reminder" (mocked WhatsApp) through the real server action; created rows are removed.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

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

const { sendRenewalReminder } = await import("@/app/(app)/renewals/actions");
const started = new Date();
const users: Record<string, U> = {};
let itemId = "";

beforeAll(async () => {
  for (const username of ["arun", "divya"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  // Vijay A's SBI Life renewal, 38 days overdue, owned by Divya
  const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "SBIL-6612093" } });
  itemId = (await prisma.renewalItem.findFirstOrThrow({ where: { policyId: policy.id, status: { in: ["Due", "Overdue"] } } })).id;
});

afterAll(async () => {
  await prisma.messageLog.deleteMany({ where: { createdAt: { gte: started }, relatedId: itemId } });
  await prisma.renewalItem.update({ where: { id: itemId }, data: { lastReminderAt: null } });
  await prisma.$disconnect();
});

describe("Renewal reminders", () => {
  it("staff remind only their own customers; the message is logged, not sent", async () => {
    session.user = users.arun;
    expect((await sendRenewalReminder(itemId)).ok).toBe(false);
    session.user = users.divya;
    expect(await sendRenewalReminder(itemId)).toEqual({ ok: true });
    const msg = await prisma.messageLog.findFirstOrThrow({ where: { relatedId: itemId, createdAt: { gte: started } } });
    expect([msg.channel, msg.template, msg.status]).toEqual(["WhatsApp", "renewal_reminder", "Sent (mock)"]);
    expect(msg.body).toMatch(/Vijay A.*SBI Life.*₹12,500 was due/);
    expect((await prisma.renewalItem.findUniqueOrThrow({ where: { id: itemId } })).lastReminderAt).not.toBeNull();
  });
});
