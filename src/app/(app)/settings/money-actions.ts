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
    micr: z.string().trim().regex(/^\d{9}$/, "MICR code is 9 digits"),
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
    fields = { bankName: v.bankName, branch: v.branch, ifsc: v.ifsc, micr: v.micr, accountKind: v.accountKind, ...enc };
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
    if (!active && a.type === "Wallet") {
      // Until E-Sevai lets staff pick the wallet, each service type pays from a fixed wallet.
      const services = await tx.serviceType.findMany({ where: { tenantId: user.tenantId, walletAccountId: id }, select: { name: true } });
      if (services.length) return fail(`${a.name} is still used by E-Sevai (${services.map((x) => x.name).join(", ")}); it can be switched off once E-Sevai entries pick their wallet`);
    }
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

// ── Payment modes and the customer bank list (net banking) ──

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
    await audit(tx, user, { entity: "PaymentOption", entityId: id, action: active ? "Activated" : "Deactivated", summary: `${o.kind === "Mode" ? "Payment mode" : "Customer bank"} ${o.name} ${active ? "switched on" : "switched off"}` });
    return done();
  });
}

const bankNameSchema = z.object({ name: z.string().trim().min(2, "Enter the bank name").max(40) });

export async function addCustomerBank(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = bankNameSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { name } = parsed.data;
  return db.$transaction(async (tx) => {
    const same = await tx.paymentOption.findFirst({ where: { tenantId: user.tenantId, kind: "Bank", name: { equals: name, mode: "insensitive" } } });
    if (same?.active) return fail(`${same.name} is already in the list`, "name");
    const o = same
      ? await tx.paymentOption.update({ where: { id: same.id }, data: { active: true } })
      : await tx.paymentOption.create({ data: { tenantId: user.tenantId, kind: "Bank", name, sort: 100 } });
    await audit(tx, user, { entity: "PaymentOption", entityId: o.id, action: "Created", summary: `Customer bank ${o.name} added` });
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
