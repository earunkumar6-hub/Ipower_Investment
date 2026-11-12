"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { ACCOUNT_KIND_LABEL, WALLET_KIND_LABEL } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { EncryptionKeyMissing, encryptJson } from "@/lib/crypto";
import { istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { DROPDOWN_LISTS, findDropdownValue, lockDropdown } from "@/lib/dropdowns";
import { D, fmtINR } from "@/lib/money";
import { MODE_LABEL, RECEIPT_MODES } from "@/lib/payment-modes";
import { authorize } from "@/lib/session";

// Settings → Bank accounts and wallets, Payment modes, Expense purposes, Day Book (Admin and Super Admin).
// Every change is written to the change log.

const fail = (error: string, field?: string): ActionResult => ({ ok: false, error, fieldErrors: field ? { [field]: error } : undefined });
const done = (): ActionResult => {
  revalidatePath("/settings", "layout");
  return { ok: true };
};
const firstIssue = (e: z.ZodError) => fail(e.issues[0].message, String(e.issues[0].path[0]));
const amount = z.string().default("").transform((s) => s.trim())
  .refine((s) => /^\d{0,10}(\.\d{1,2})?$/.test(s), "Enter an amount")
  .transform((s) => new D(s || 0));

// ── Bank accounts and wallets ──

const accountSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().optional(),
    type: z.literal("Bank"),
    bankName: z.string().trim().min(2, "Enter the bank").max(40),
    branch: z.string().trim().min(2, "Enter the branch").max(60),
    accountNo: z.string().trim().regex(/^(\d{6,18})?$/, "Account number should be 6–18 digits"),
    ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like SBIN0001234"),
    micr: z.string().trim().regex(/^(\d{9})?$/, "MICR code is 9 digits"), // optional (owner change list, #27)
    accountKind: z.enum(["Savings", "Current"], "Pick Savings or Current"),
    openingBalance: amount,
  }),
  z.object({
    id: z.string().optional(),
    type: z.literal("Wallet"),
    walletKind: z.enum(["CSC", "ESevai", "Other"], "Pick the wallet"),
    otherName: z.string().trim().max(40).default(""),
    lowBalanceThreshold: amount,
    openingBalance: amount,
  }),
]);

/** Adds or edits a bank account or wallet. Opening balance only when adding; the account number is stored encrypted. */
export async function saveAccount(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = accountSchema.safeParse({ ...Object.fromEntries(form), id: form.get("id") || undefined });
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;

  let fields: Record<string, unknown>;
  if (v.type === "Bank") {
    if (!v.id && !v.accountNo) return fail("Enter the account number", "accountNo");
    let enc: { accountNoEnc: string; last4: string } | Record<string, never> = {};
    if (v.accountNo) {
      try {
        enc = { accountNoEnc: encryptJson(v.accountNo), last4: v.accountNo.slice(-4) };
      } catch (e) {
        if (e instanceof EncryptionKeyMissing) return fail(e.message);
        throw e;
      }
    }
    fields = { bankName: v.bankName, branch: v.branch, ifsc: v.ifsc, micr: v.micr || null, accountKind: v.accountKind, ...enc };
  } else {
    if (v.walletKind === "Other" && v.otherName.length < 2) return fail("Enter the wallet name", "otherName");
    fields = { walletKind: v.walletKind, name: v.walletKind === "Other" ? v.otherName : WALLET_KIND_LABEL[v.walletKind], lowBalanceThreshold: v.lowBalanceThreshold.isZero() ? null : v.lowBalanceThreshold };
  }

  return db.$transaction(async (tx) => {
    const before = v.id ? await tx.account.findFirst({ where: { id: v.id, tenantId: user.tenantId } }) : null;
    if (v.id && !before) return fail("Account not found");
    if (before && before.type !== v.type) return fail("The account type can't be changed");
    const last4 = (fields.last4 as string | undefined) ?? before?.last4;
    if (v.type === "Bank") fields.name = `${v.bankName} ${ACCOUNT_KIND_LABEL[v.accountKind].toLowerCase()} ••${last4}`;
    const clash = await tx.account.findFirst({ where: { tenantId: user.tenantId, name: { equals: fields.name as string, mode: "insensitive" }, ...(v.id && { id: { not: v.id } }) } });
    if (clash) return fail(`${clash.name} already exists`, v.type === "Wallet" ? "walletKind" : "accountNo");

    const shown = (a: Record<string, unknown>) => ({ name: a.name, bank: a.bankName, branch: a.branch, ifsc: a.ifsc, micr: a.micr, type: a.accountKind, wallet: a.walletKind, low: a.lowBalanceThreshold?.toString() });
    if (before) {
      const a = await tx.account.update({ where: { id: before.id }, data: fields });
      await audit(tx, user, { entity: "Account", entityId: a.id, action: "Updated", summary: `${a.name} updated`, before: shown(before), after: shown(a) });
    } else {
      const isFirstBank = v.type === "Bank" && !(await tx.account.findFirst({ where: { tenantId: user.tenantId, type: "Bank", active: true } }));
      const a = await tx.account.create({
        data: { tenantId: user.tenantId, type: v.type, name: fields.name as string, openingBalance: v.openingBalance, openingDate: istToday(), isDefault: isFirstBank, ...fields },
      });
      await audit(tx, user, { entity: "Account", entityId: a.id, action: "Created", summary: `${a.name} added (opening ${fmtINR(v.openingBalance)})`, after: shown(a) });
    }
    return done();
  });
}

/** Deactivate (hidden from new entries, kept on old ones) or reactivate. Accounts are never deleted. */
export async function setAccountActive(id: string, active: boolean): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  return db.$transaction(async (tx) => {
    const a = await tx.account.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!a) return fail("Account not found");
    if (!active && a.isDefault) return fail(`${a.name} is the default ${a.type === "Cash" ? "cash account" : "bank account"}; make another one the default first`);
    if (!active && a.type === "Cash") return fail("Office cash can't be switched off");
    await tx.account.update({ where: { id }, data: { active } });
    await audit(tx, user, { entity: "Account", entityId: id, action: active ? "Activated" : "Deactivated", summary: `${a.name} ${active ? "switched on" : "switched off"}` });
    return done();
  });
}

/** The bank account money lands in on screens that don't yet ask which account. */
export async function setDefaultBank(id: string): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  return db.$transaction(async (tx) => {
    const a = await tx.account.findFirst({ where: { id, tenantId: user.tenantId, type: "Bank", active: true } });
    if (!a) return fail("Pick an active bank account");
    await tx.account.updateMany({ where: { tenantId: user.tenantId, type: "Bank", isDefault: true }, data: { isDefault: false } });
    await tx.account.update({ where: { id }, data: { isDefault: true } });
    await audit(tx, user, { entity: "Account", entityId: id, action: "Default", summary: `${a.name} is now the default bank account` });
    return done();
  });
}

// ── Payment modes (the customer bank list was removed: owner change list, #29) ──

export async function setPayOptionActive(id: string, active: boolean): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  return db.$transaction(async (tx) => {
    const o = await tx.paymentOption.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!o) return fail("Not found");
    if (!active && o.kind === "Mode") {
      const on = await tx.paymentOption.count({ where: { tenantId: user.tenantId, kind: "Mode", active: true } });
      if (on <= 1) return fail("At least one payment mode must stay on");
    }
    await tx.paymentOption.update({ where: { id }, data: { active } });
    await audit(tx, user, { entity: "PaymentOption", entityId: id, action: active ? "Activated" : "Deactivated", summary: `Payment mode ${payModeName(o)} ${active ? "switched on" : "switched off"}` });
    return done();
  });
}

/** "Net banking" for a built-in mode, the agency's own name otherwise. */
const payModeName = (o: { name: string; base: string | null }) => (o.base ? o.name : MODE_LABEL[o.name as keyof typeof MODE_LABEL] ?? o.name);

// Pay modes the agency adds (owner change list, #28): its own name, behaving like one of the built-in modes –
// the money rules (cash notes, UTR, cheque no., received-into account) are the built-in mode's.
const payModeSchema = z.object({
  id: z.string().default(""),
  name: z.string().trim().min(2, "Enter the name of the pay mode").max(30),
  base: z.enum(RECEIPT_MODES, "Pick what it works like"),
});

/** Is the name free? Not a built-in mode (by its name or label) and not another mode of this agency. */
async function payModeNameTaken(tx: Pick<typeof db, "paymentOption">, tenantId: string, name: string, exceptId: string) {
  const lower = name.toLowerCase();
  if (RECEIPT_MODES.some((m) => m.toLowerCase() === lower || MODE_LABEL[m].toLowerCase() === lower)) return true;
  return !!(await tx.paymentOption.findFirst({ where: { tenantId, kind: "Mode", name: { equals: name, mode: "insensitive" }, NOT: { id: exceptId || undefined } } }));
}

/** Receipts, payments and direct bills taken with this mode (they keep its name as text). */
async function payModeUses(tx: Pick<typeof db, "receipt" | "payment" | "directBill">, tenantId: string, name: string) {
  const where = { tenantId, modeName: name };
  const [receipts, payments, bills] = await Promise.all([tx.receipt.count({ where }), tx.payment.count({ where }), tx.directBill.count({ where })]);
  return receipts + payments + bills;
}

/** Add a pay mode, or change one the agency added (its name; what it works like only while unused). */
export async function savePayMode(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = payModeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { id, name, base } = parsed.data;
  return db.$transaction(async (tx) => {
    if (await payModeNameTaken(tx, user.tenantId, name, id)) return fail(`${name} is already a pay mode`, "name");
    if (!id) {
      const last = await tx.paymentOption.aggregate({ where: { tenantId: user.tenantId, kind: "Mode" }, _max: { sort: true } });
      const o = await tx.paymentOption.create({ data: { tenantId: user.tenantId, kind: "Mode", name, base, sort: (last._max.sort ?? 0) + 1 } });
      await audit(tx, user, { entity: "PaymentOption", entityId: o.id, action: "Created", summary: `Payment mode ${name} added (works like ${MODE_LABEL[base]})` });
      return done();
    }
    const o = await tx.paymentOption.findFirst({ where: { id, tenantId: user.tenantId, kind: "Mode" } });
    if (!o) return fail("Not found");
    if (!o.base) return fail("A built-in pay mode can't be changed – switch it off instead");
    if (o.name === name && o.base === base) return done();
    if (o.base !== base && (await payModeUses(tx, user.tenantId, o.name)) > 0) return fail(`${o.name} is on saved receipts, so what it works like can't change`, "base");
    await tx.paymentOption.update({ where: { id }, data: { name, base } });
    await audit(tx, user, {
      entity: "PaymentOption", entityId: id, action: "Updated", summary: `Payment mode ${o.name} changed`,
      before: { name: o.name, worksLike: MODE_LABEL[o.base] }, after: { name, worksLike: MODE_LABEL[base] },
    });
    return done();
  });
}

/** Delete a pay mode the agency added, while no receipt or bill uses it; otherwise it can only be switched off. */
export async function deletePayMode(id: string): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  return db.$transaction(async (tx) => {
    const o = await tx.paymentOption.findFirst({ where: { id, tenantId: user.tenantId, kind: "Mode" } });
    if (!o) return fail("Not found");
    if (!o.base) return fail("A built-in pay mode can't be deleted – switch it off instead");
    const uses = await payModeUses(tx, user.tenantId, o.name);
    if (uses > 0) return fail(`${o.name} is on ${uses} saved receipt(s) or bill(s), so it can't be deleted – switch it off instead`);
    if (o.active && (await tx.paymentOption.count({ where: { tenantId: user.tenantId, kind: "Mode", active: true } })) <= 1) return fail("At least one payment mode must stay on");
    await tx.paymentOption.delete({ where: { id } });
    await audit(tx, user, { entity: "PaymentOption", entityId: id, action: "Deleted", summary: `Payment mode ${o.name} deleted` });
    return done();
  });
}

// ── Dropdown values (expense purposes) ──

const dropdownSchema = z.object({ list: z.enum(Object.keys(DROPDOWN_LISTS) as [keyof typeof DROPDOWN_LISTS]), value: z.string().trim().min(2, "Enter the value").max(60) });

export async function addDropdownValue(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = dropdownSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { list, value } = parsed.data;
  if (value.toLowerCase() === "other") return fail("'Other' is always offered; add a specific value", "value");
  return db.$transaction(async (tx) => {
    await lockDropdown(tx, user.tenantId, list);
    const same = await findDropdownValue(tx, user.tenantId, list, value);
    if (same?.active) return fail(`${same.value} is already in the list`, "value");
    const o = same
      ? await tx.dropdownOption.update({ where: { id: same.id }, data: { active: true } })
      : await tx.dropdownOption.create({ data: { tenantId: user.tenantId, list, value, sort: 100, createdById: user.id } });
    await audit(tx, user, { entity: "DropdownOption", entityId: o.id, action: "Created", summary: `${DROPDOWN_LISTS[list]}: ${o.value} added` });
    return done();
  });
}

export async function setDropdownActive(id: string, active: boolean): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  return db.$transaction(async (tx) => {
    const o = await tx.dropdownOption.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!o) return fail("Not found");
    await tx.dropdownOption.update({ where: { id }, data: { active } });
    const label = DROPDOWN_LISTS[o.list as keyof typeof DROPDOWN_LISTS] ?? o.list;
    await audit(tx, user, { entity: "DropdownOption", entityId: id, action: active ? "Activated" : "Removed", summary: `${label}: ${o.value} ${active ? "brought back" : "removed (kept on old records)"}` });
    return done();
  });
}

// ── Day Book ──

const graceSchema = z.object({ graceDays: z.coerce.number("Enter the number of days").int("Whole days only").min(0, "0 or more").max(30, "30 days at most") });

/** Days after which an open Day Book locks and only the Super Admin can close it (enforced from the Day Book phase). */
export async function saveGraceDays(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = graceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { graceDays } = parsed.data;
  return db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    if (t.dayCloseGraceDays === graceDays) return done();
    await tx.tenant.update({ where: { id: t.id }, data: { dayCloseGraceDays: graceDays } });
    await audit(tx, user, { entity: "Tenant", entityId: t.id, action: "Updated", summary: `Day Book grace period ${t.dayCloseGraceDays} → ${graceDays} days`, before: { graceDays: t.dayCloseGraceDays }, after: { graceDays } });
    return done();
  });
}
