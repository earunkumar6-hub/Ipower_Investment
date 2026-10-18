// Server-action tests against the seeded database. Every row they create is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, isoDate, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string } }));
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

const { createLead } = await import("@/app/(app)/leads/actions");

const created: string[] = [];
const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
// A mobile no seeded lead uses.
const mobile = `9${String(Date.now()).slice(-9)}`;
const base = { name: "Test Lead", mobile, email: "", dob: "", address: "", source: "WalkIn", interest: "", ownerId: "", callDate: "", callTime: "" };

beforeAll(async () => {
  const arun = await prisma.user.findFirstOrThrow({ where: { username: "arun" } });
  session.user = { id: arun.id, name: arun.name, username: "arun", role: "User", tenantId: arun.tenantId };
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("Lead fields", () => {
  it("date of birth must be in the past", async () => {
    const r = await createLead({ ok: false }, form({ ...base, dob: isoDate(istToday()) }));
    expect(r.fieldErrors).toHaveProperty("dob");
  });

  it("saves date of birth, address and the WhatsApp tick", async () => {
    const dob = addDays(istToday(), -365 * 30);
    const r = await createLead({ ok: false }, form({ ...base, dob: isoDate(dob), address: "12 Gandhi Road, Salem", onWhatsApp: "on" }));
    expect(r).toMatchObject({ ok: true });
    created.push(r.id!);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.id } });
    expect([lead.dob, lead.address, lead.onWhatsApp]).toEqual([dob, "12 Gandhi Road, Salem", true]);
  });

  it("all three stay optional; an unticked box means not on WhatsApp", async () => {
    const r = await createLead({ ok: false }, form({ ...base, mobile: `8${mobile.slice(1)}` }));
    expect(r).toMatchObject({ ok: true });
    created.push(r.id!);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.id } });
    expect([lead.dob, lead.address, lead.onWhatsApp]).toEqual([null, null, false]);
  });
});
