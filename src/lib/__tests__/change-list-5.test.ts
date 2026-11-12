// Owner change list phase 5 (12 Nov 2026): quotation tabs and "Mark as sent" (#35), issued proposals leave the
// Proposals list and its download (#23), and the full customer list download has every customer column (#34).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/session";

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

const { markQuotationSent } = await import("@/app/(app)/quotations/actions");
const { QUOTE_TAB_WHERE, quotationStatus, quoteTab } = await import("@/lib/quotation");
const { REPORTS } = await import("@/lib/exports");

const today = istToday();
let arun: U, admin: U;
let quoteId = "";

beforeAll(async () => {
  for (const username of ["arun", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    const v = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
    if (username === "arun") arun = v; else admin = v;
  }
  const q = await prisma.quotation.create({
    data: {
      tenantId: arun.tenantId, quoteNo: `Q-VT5-${Date.now() % 1e6}`, customerName: "Vitest Quote", mobile: "6000055501", validUpto: addDays(today, 15),
      subtotal: "1000.00", total: "1000.00", ownerId: arun.id,
    },
  });
  quoteId = q.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: quoteId } });
  await prisma.quotation.delete({ where: { id: quoteId } });
  await prisma.$disconnect();
});

const tabOf = async (id: string) => {
  for (const t of ["drafts", "sent", "converted", "notaccepted"] as const) {
    if (await prisma.quotation.count({ where: { id, ...QUOTE_TAB_WHERE[t] } })) return t;
  }
  return null;
};

describe("Quotation tabs and Mark as sent (#35)", () => {
  it("a new quotation is a Draft; Mark as sent moves it to Sent once, logged with who", async () => {
    expect(quoteTab(undefined)).toBe("drafts");
    expect(await tabOf(quoteId)).toBe("drafts");
    session.user = arun;
    expect(await markQuotationSent(quoteId)).toEqual({ ok: true });
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quoteId }, include: { items: { include: { proposal: true } } } });
    expect([!!q.sentAt, q.sentById]).toEqual([true, arun.id]);
    expect(quotationStatus(q, today)[0]).toBe("Sent");
    expect(await tabOf(quoteId)).toBe("sent");
    expect((await markQuotationSent(quoteId)).error).toMatch(/Already marked/);
    expect(await prisma.auditLog.count({ where: { entityId: quoteId, action: "Sent" } })).toBe(1);
  });

  it("a quotation the customer said no to can't be marked sent, and sits on Not accepted", async () => {
    await prisma.quotation.update({ where: { id: quoteId }, data: { status: "NotAccepted", sentAt: null } });
    session.user = arun;
    expect((await markQuotationSent(quoteId)).error).toMatch(/already decided/);
    expect(await tabOf(quoteId)).toBe("notaccepted");
  });
});

describe("Proposals download leaves out issued ones (#23)", () => {
  it("issued proposals only with issued=1", async () => {
    // One proposal is marked issued for this check and put back afterwards.
    const p = await prisma.proposal.findFirstOrThrow({ where: { tenantId: admin.tenantId, status: { not: "Issued" } } });
    await prisma.proposal.update({ where: { id: p.id }, data: { status: "Issued" } });
    try {
      const all = await prisma.proposal.count({ where: { tenantId: admin.tenantId } });
      const issued = await prisma.proposal.count({ where: { tenantId: admin.tenantId, status: "Issued" } });
      const open = await REPORTS.proposals.build(admin as SessionUser, {});
      const everything = await REPORTS.proposals.build(admin as SessionUser, { issued: "1" });
      expect(open!.sheets[0].rows).toHaveLength(all - issued);
      expect(open!.sheets[0].rows.some((r) => r[0] === p.proposalNo)).toBe(false);
      expect(everything!.sheets[0].rows).toHaveLength(all);
    } finally {
      await prisma.proposal.update({ where: { id: p.id }, data: { status: p.status } });
    }
  });
});

describe("Customer list download has every customer column (#34)", () => {
  it("contact details, masked identity numbers, consent, staff and date added", async () => {
    const built = await REPORTS.customers.build(admin as SessionUser, {});
    const headers = built!.sheets[0].columns.map((c) => c.header);
    expect(headers.slice(0, 11)).toEqual(["Customer", "Mobile", "Other mobiles", "WhatsApp", "Email", "Address", "PAN", "Aadhaar", "Consent taken", "Staff", "Added on"]);
    const rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
    const row = built!.sheets[0].rows.find((r) => r[0] === "Rajesh Kumar")!;
    expect(row[1]).toMatch(/^\d{2}x+\d{2}$/); // masked like every export
    expect(row[1]).not.toBe(rajesh.mobile);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: rajesh.ownerId } });
    expect(row[9]).toBe(owner.name); // the staff member's name, not an id
  });
});
