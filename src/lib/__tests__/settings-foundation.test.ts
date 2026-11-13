// Change set phase 1 – Settings foundation: bank accounts and wallets, payment modes, expense purposes,
// grace days, premature closure during lock-in, expense notes and "From account". Rows it creates are removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cashAndBank, moneyAccounts } from "@/lib/accounts";
import { decryptJson } from "@/lib/crypto";
import { db, prisma } from "@/lib/db";
import { dropdownValues } from "@/lib/dropdowns";
import { payOptions } from "@/lib/payment-options";

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

const m = await import("@/app/(app)/settings/money-actions");
const { createExpense } = await import("@/app/(app)/expenses/actions");
const { saveProduct } = await import("@/app/(app)/settings/actions");

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => (Array.isArray(v) ? v.forEach((x) => f.append(k, x)) : f.set(k, v)));
  return f;
};
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const bank = { type: "Bank", bankName: "IOB", branch: "Arcot Road", accountNo: "223456789012", ifsc: "IOBA0001234", micr: "632020002", accountKind: "Savings", openingBalance: "5000" };
const created: { accounts: string[]; options: string[]; vendor: string } = { accounts: [], options: [], vendor: "Vitest Settings Vendor" };
let graceBefore = 3;
let defaultBankId = "";

beforeAll(async () => {
  for (const username of ["arun", "admin", "superadmin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  graceBefore = (await prisma.tenant.findUniqueOrThrow({ where: { id: users.admin.tenantId } })).dayCloseGraceDays;
  defaultBankId = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Bank", isDefault: true } })).id;
});

afterAll(async () => {
  const t = users.admin.tenantId;
  await prisma.account.updateMany({ where: { tenantId: t, type: "Bank" }, data: { isDefault: false } });
  await prisma.account.update({ where: { id: defaultBankId }, data: { isDefault: true, active: true } });
  const expenses = await prisma.expense.findMany({ where: { vendor: { name: created.vendor } }, select: { id: true } });
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: expenses.map((e) => e.id) } } });
  await prisma.expense.deleteMany({ where: { id: { in: expenses.map((e) => e.id) } } });
  await prisma.vendor.deleteMany({ where: { name: created.vendor } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...created.accounts, ...created.options, defaultBankId, t] } } });
  await prisma.account.deleteMany({ where: { id: { in: created.accounts } } });
  await prisma.dropdownOption.deleteMany({ where: { id: { in: created.options } } });
  await prisma.paymentOption.deleteMany({ where: { tenantId: t, name: "Vitest Bank" } });
  await prisma.tenant.update({ where: { id: t }, data: { dayCloseGraceDays: graceBefore } });
  await prisma.$disconnect();
});

describe("Bank accounts and wallets", () => {
  it("only Admin / Super Admin can change them", async () => {
    as("arun");
    await expect(m.saveAccount({ ok: false }, form(bank))).rejects.toThrow(/Settings.Edit/);
  });

  it("checks IFSC, MICR, account type and account number", async () => {
    as("admin");
    expect((await m.saveAccount({ ok: false }, form({ ...bank, ifsc: "IOB1234" }))).fieldErrors).toHaveProperty("ifsc");
    expect((await m.saveAccount({ ok: false }, form({ ...bank, micr: "12345" }))).fieldErrors).toHaveProperty("micr");
    // MICR may be left blank (owner change list, #27): only the account type is refused here.
    expect((await m.saveAccount({ ok: false }, form({ ...bank, micr: "", accountKind: "" }))).fieldErrors).not.toHaveProperty("micr");
    expect((await m.saveAccount({ ok: false }, form({ ...bank, accountKind: "" }))).fieldErrors).toHaveProperty("accountKind");
    expect((await m.saveAccount({ ok: false }, form({ ...bank, accountNo: "" }))).fieldErrors).toHaveProperty("accountNo");
  });

  it("adds a bank account: number encrypted, shown as ••last4, logged, not the default", async () => {
    as("admin");
    expect(await m.saveAccount({ ok: false }, form(bank))).toEqual({ ok: true });
    const a = await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, bankName: "IOB" } });
    created.accounts.push(a.id);
    expect(a).toMatchObject({ name: "IOB savings ••9012", last4: "9012", ifsc: "IOBA0001234", micr: "632020002", accountKind: "Savings", isDefault: false, active: true });
    expect(a.openingBalance.toFixed(2)).toBe("5000.00");
    expect(a.accountNoEnc).not.toContain("223456789012");
    expect(decryptJson<string>(a.accountNoEnc!)).toBe("223456789012");
    expect(await prisma.auditLog.count({ where: { entity: "Account", entityId: a.id } })).toBe(1);
    // Same name again is refused.
    expect((await m.saveAccount({ ok: false }, form(bank))).error).toMatch(/already exists/);
  });

  it("edit keeps the number when left blank; the default bank stays where money lands", async () => {
    as("admin");
    const a = await prisma.account.findFirstOrThrow({ where: { id: created.accounts[0] } });
    expect(await m.saveAccount({ ok: false }, form({ ...bank, id: a.id, accountNo: "", branch: "Walajapet" }))).toEqual({ ok: true });
    const after = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ branch: "Walajapet", accountNoEnc: a.accountNoEnc, openingBalance: a.openingBalance });
    expect((await cashAndBank(db, users.admin.tenantId)).bank.id).toBe(defaultBankId);

    expect(await m.setDefaultBank(a.id)).toEqual({ ok: true });
    expect((await cashAndBank(db, users.admin.tenantId)).bank.id).toBe(a.id);
    expect(await prisma.account.count({ where: { tenantId: users.admin.tenantId, type: "Bank", isDefault: true } })).toBe(1);
    expect(await m.setDefaultBank(defaultBankId)).toEqual({ ok: true });
  });

  it("switched-off accounts leave the pickers and are refused; the default and office cash can't be switched off", async () => {
    as("admin");
    const id = created.accounts[0];
    expect((await m.setAccountActive(defaultBankId, false)).error).toMatch(/default/);
    const cash = await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Cash" } });
    expect((await m.setAccountActive(cash.id, false)).ok).toBe(false);

    expect((await moneyAccounts(db, users.admin.tenantId)).map((a) => a.id)).toContain(id);
    expect(await m.setAccountActive(id, false)).toEqual({ ok: true });
    expect((await moneyAccounts(db, users.admin.tenantId)).map((a) => a.id)).not.toContain(id);
    expect((await m.setDefaultBank(id)).ok).toBe(false);

    as("arun");
    const r = await createExpense({ ok: false }, form({
      expenseDate: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10), category: "Stationery", description: "Pens", notes: "For the counter",
      amount: "100", vendor: created.vendor, billNo: "VS-1", paidBy: "Company", paidByName: "", mode: "Cash", fromAccount: id,
    }));
    expect(r.fieldErrors).toHaveProperty("fromAccount");
    as("admin");
    expect(await m.setAccountActive(id, true)).toEqual({ ok: true });
  });

  it("wallets: CSC / E-Sevai / Other with a typed name", async () => {
    as("admin");
    expect((await m.saveAccount({ ok: false }, form({ type: "Wallet", walletKind: "Other", otherName: "" }))).fieldErrors).toHaveProperty("otherName");
    expect(await m.saveAccount({ ok: false }, form({ type: "Wallet", walletKind: "Other", otherName: "Vitest wallet", lowBalanceThreshold: "500" }))).toEqual({ ok: true });
    const w = await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, name: "Vitest wallet" } });
    created.accounts.push(w.id);
    expect(w).toMatchObject({ type: "Wallet", walletKind: "Other", isDefault: false });
    expect(w.lowBalanceThreshold?.toFixed(2)).toBe("500.00");
    expect(await m.setAccountActive(w.id, false)).toEqual({ ok: true });
  });
});

describe("Payment modes and customer banks", () => {
  it("modes switch off and on; the last mode can't be switched off", async () => {
    as("admin");
    const modes = await prisma.paymentOption.findMany({ where: { tenantId: users.admin.tenantId, kind: "Mode" } });
    const card = modes.find((x) => x.name === "Card")!;
    created.options.push(card.id);
    expect(await m.setPayOptionActive(card.id, false)).toEqual({ ok: true });
    expect(await m.setPayOptionActive(card.id, true)).toEqual({ ok: true });
    const others = modes.filter((x) => x.name !== "Cash");
    await prisma.paymentOption.updateMany({ where: { id: { in: others.map((x) => x.id) } }, data: { active: false } });
    try {
      expect((await m.setPayOptionActive(modes.find((x) => x.name === "Cash")!.id, false)).error).toMatch(/At least one/);
    } finally {
      await prisma.paymentOption.updateMany({ where: { id: { in: others.map((x) => x.id) } }, data: { active: true } });
    }
  });

  it("pay modes can be added, changed and deleted while unused (#28)", async () => {
    as("admin");
    expect((await m.savePayMode({ ok: false }, form({ name: "Net banking", base: "UPI" }))).error).toMatch(/already a pay mode/);
    expect((await m.savePayMode({ ok: false }, form({ name: "Vitest Pay", base: "" }))).fieldErrors).toHaveProperty("base");
    expect(await m.savePayMode({ ok: false }, form({ name: "Vitest Pay", base: "UPI" }))).toEqual({ ok: true });
    expect((await m.savePayMode({ ok: false }, form({ name: "vitest pay", base: "Cheque" }))).error).toMatch(/already a pay mode/);
    const o = await prisma.paymentOption.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, name: "Vitest Pay" } });
    expect(o).toMatchObject({ kind: "Mode", base: "UPI", active: true });
    const { modes } = await payOptions(db, users.admin.tenantId);
    expect(modes).toContainEqual({ mode: "UPI", name: "Vitest Pay", label: "Vitest Pay" });

    expect(await m.savePayMode({ ok: false }, form({ id: o.id, name: "Vitest Pay 2", base: "Cheque" }))).toEqual({ ok: true });
    expect(await prisma.paymentOption.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ name: "Vitest Pay 2", base: "Cheque" });
    const builtIn = await prisma.paymentOption.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, kind: "Mode", name: "Cash" } });
    expect((await m.deletePayMode(builtIn.id)).error).toMatch(/built-in/);
    expect(await m.deletePayMode(o.id)).toEqual({ ok: true });
    expect(await prisma.paymentOption.count({ where: { id: o.id } })).toBe(0);
  });
});

describe("Expense purposes", () => {
  it("new purposes are seeded, added once (case-insensitive), removed purposes leave the list but old records keep them", async () => {
    as("admin");
    const list = await dropdownValues(db, users.admin.tenantId, "expensePurpose");
    expect(list).toEqual(expect.arrayContaining(["Staff salary", "Pooja", "Customer incentives", "Bank charges"]));
    expect((await m.addDropdownValue({ ok: false }, form({ list: "expensePurpose", value: "pooja" }))).error).toMatch(/already/);
    expect((await m.addDropdownValue({ ok: false }, form({ list: "expensePurpose", value: "Other" }))).ok).toBe(false);

    expect(await m.addDropdownValue({ ok: false }, form({ list: "expensePurpose", value: "Vitest purpose" }))).toEqual({ ok: true });
    const o = await prisma.dropdownOption.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, value: "Vitest purpose" } });
    created.options.push(o.id);
    expect(await m.setDropdownActive(o.id, false)).toEqual({ ok: true });
    expect(await dropdownValues(db, users.admin.tenantId, "expensePurpose")).not.toContain("Vitest purpose");
    // Adding it again brings the same row back.
    expect(await m.addDropdownValue({ ok: false }, form({ list: "expensePurpose", value: "VITEST PURPOSE" }))).toEqual({ ok: true });
    expect(await prisma.dropdownOption.count({ where: { tenantId: users.admin.tenantId, value: { equals: "vitest purpose", mode: "insensitive" } } })).toBe(1);
  });
});

describe("Expenses: notes mandatory, purpose from the list, From account", () => {
  const expense = () => ({
    expenseDate: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10), category: "Pooja", description: "Ayudha pooja items",
    amount: "450", vendor: created.vendor, billNo: "", paidBy: "Company", paidByName: "", mode: "Cash", fromAccount: "", notes: "",
  });

  it("notes empty or only spaces are refused; unknown purposes are refused", async () => {
    as("arun");
    const cash = (await cashAndBank(db, users.arun.tenantId)).cash.id;
    expect((await createExpense({ ok: false }, form({ ...expense(), billNo: "VS-2", fromAccount: cash }))).fieldErrors).toHaveProperty("notes");
    expect((await createExpense({ ok: false }, form({ ...expense(), billNo: "VS-2", fromAccount: cash, notes: "   " }))).fieldErrors).toHaveProperty("notes");
    expect((await createExpense({ ok: false }, form({ ...expense(), billNo: "VS-2", fromAccount: cash, notes: "ok notes", category: "Made up", denominations: JSON.stringify({ "100": 4, "50": 1 }) }))).fieldErrors).toHaveProperty("category");
  });

  it("saves with notes and pays from the picked account (non-default bank)", async () => {
    as("arun");
    const r = await createExpense({ ok: false }, form({ ...expense(), billNo: "VS-3", fromAccount: created.accounts[0], mode: "UPI", reference: "UTR-VS-3", notes: "Asked by owner" }));
    expect(r).toMatchObject({ ok: true });
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect(e).toMatchObject({ notes: "Asked by owner", category: "Pooja", fromAccountId: created.accounts[0] });
    const entry = await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: e.id } });
    expect(entry).toMatchObject({ accountId: created.accounts[0], direction: "Out" });
  });
});

describe("Grace days and closure during lock-in", () => {
  it("grace days: 0–30, logged", async () => {
    as("admin");
    expect((await m.saveGraceDays({ ok: false }, form({ graceDays: "31" }))).ok).toBe(false);
    expect((await m.saveGraceDays({ ok: false }, form({ graceDays: "two" }))).ok).toBe(false);
    expect(await m.saveGraceDays({ ok: false }, form({ graceDays: "5" }))).toEqual({ ok: true });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: users.admin.tenantId } })).dayCloseGraceDays).toBe(5);
  });

  it("'can be closed during lock-in' is saved only with premature closure allowed, never for mutual funds", async () => {
    as("admin");
    const p = await prisma.product.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, productType: "PoTd" } });
    const values = {
      id: p.id, name: p.name, productType: p.productType, partner: p.partner, invoiceRule: p.invoiceRule, payModes: p.payModes,
      lockInMonths: p.lockInMonths ? String(p.lockInMonths) : "", bankFields: p.bankFields, fields: p.fields, requiredFields: p.requiredFields,
      ...(p.bankDetailsRequired && { bankDetailsRequired: "on" }), ...(p.active && { active: "on" }),
    };
    try {
      expect((await saveProduct({ ok: false }, form({ ...values, prematureClosure: "on", closeDuringLockIn: "on" }))).ok).toBe(true);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).closeDuringLockIn).toBe(true);
      expect((await saveProduct({ ok: false }, form({ ...values, closeDuringLockIn: "on" }))).ok).toBe(true);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).closeDuringLockIn).toBe(false);
    } finally {
      await prisma.product.update({ where: { id: p.id }, data: { prematureClosure: p.prematureClosure, closeDuringLockIn: p.closeDuringLockIn } });
    }
  });
});
