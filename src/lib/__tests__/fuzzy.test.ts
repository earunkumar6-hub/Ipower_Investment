import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fuzzyMatches } from "@/lib/fuzzy";
import { customerFilter } from "@/lib/lists";
import type { SessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";

// Writes to DATABASE_URL – run on a scratch database (see CLAUDE.md).
const TAG = "FuzzyVitest";
let tenantId: string, otherTenantId: string;
const ids: string[] = [];

async function customer(tenant: string, name: string, n: number) {
  const c = await prisma.customer.create({ data: { tenantId: tenant, name, mobile: `98000000${n}`, ownerId: (await prisma.user.findFirstOrThrow({ where: { tenantId: tenant } })).id } });
  ids.push(c.id);
  return c.id;
}

describe("fuzzyMatches", () => {
  let murali: string, other: string;
  beforeAll(async () => {
    const tenants = await prisma.tenant.findMany({ take: 2 });
    tenantId = tenants[0].id;
    otherTenantId = tenants[1]?.id ?? tenantId;
    murali = await customer(tenantId, `${TAG} Murali Kumar`, 1);
    await customer(tenantId, `${TAG} Zebra Stripes`, 2);
    other = await customer(otherTenantId, `${TAG} Murali Kumar`, 3);
  });
  afterAll(async () => { await prisma.customer.deleteMany({ where: { id: { in: ids } } }); });

  it("finds a name typed with a typo", async () => {
    const r = await fuzzyMatches(tenantId, "Murli", ["customer"]);
    expect(r.customer).toContain(murali);
  });
  it("does not return unrelated names", async () => {
    const r = await fuzzyMatches(tenantId, "Murli", ["customer"]);
    expect(r.customer?.length).toBeGreaterThan(0);
    const rows = await prisma.customer.findMany({ where: { id: { in: r.customer } }, select: { name: true } });
    expect(rows.some((x) => x.name.includes("Zebra"))).toBe(false);
  });
  it("stays inside the tenant", async () => {
    if (otherTenantId === tenantId) return;
    const r = await fuzzyMatches(tenantId, "Murli", ["customer"]);
    expect(r.customer).not.toContain(other);
  });
  it("skips short or empty input", async () => {
    expect(await fuzzyMatches(tenantId, "mu", ["customer"])).toEqual({});
    expect(await fuzzyMatches(tenantId, "  ", ["customer"])).toEqual({});
    expect(await fuzzyMatches(tenantId, undefined, ["customer"])).toEqual({});
  });
});

describe("one or two letters", () => {
  it("matches names and words that start with the letter, not any name containing it", async () => {
    const t = (await prisma.tenant.findFirstOrThrow()).id;
    const mk = async (name: string, n: number) => (await prisma.customer.create({ data: { tenantId: t, name, mobile: `97000000${n}`, ownerId: (await prisma.user.findFirstOrThrow({ where: { tenantId: t } })).id } })).id;
    const made = [await mk("Qzx Arun", 1), await mk("Qzy Kumar", 2), await mk("Aqz Divya", 3)];
    try {
      const user = { id: "x", tenantId: t, role: "SuperAdmin" } as unknown as SessionUser;
      const names = async (q: string) => (await prisma.customer.findMany({ where: { ...customerFilter(user, { q }).where, id: { in: made } } })).map((c) => c.name).sort();
      expect(await names("a")).toEqual(["Aqz Divya", "Qzx Arun"]); // Qzy Kumar has an "a" inside only
      expect(await names("k")).toEqual(["Qzy Kumar"]);
      expect(await names("kum")).toEqual(["Qzy Kumar"]);
    } finally {
      await prisma.customer.deleteMany({ where: { id: { in: made } } });
    }
  });
});
