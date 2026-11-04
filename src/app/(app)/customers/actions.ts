"use server";

import { Frequency, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { audit, changedOnly } from "@/lib/audit";
import { EncryptionKeyMissing, encryptJson } from "@/lib/crypto";
import { addMonths, fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { AADHAAR_RE, duplicateCompanyCif, duplicateIdentity, duplicateMessage, identityData, maskPan, PAN_RE } from "@/lib/identity";
import { canActOn } from "@/lib/leads";
import { mobilesText, readMobiles } from "@/lib/mobiles";
import { nextNumber } from "@/lib/numbering";
import { photoProblem, savePhoto } from "@/lib/photos";
import { createPolicyWithSchedule } from "@/lib/policies";
import { BANK_FIELDS, isHealthCover, isPostal, lockInUntil, missingInsuranceDetails, needsSipDay, PAY_MODE_LABEL, rateOn, type BankField } from "@/lib/products";
import { authorize } from "@/lib/session";

const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({ ok: false, error, fieldErrors });

const closeSchema = z.object({
  policyId: z.string().min(1),
  kind: z.enum(["close", "withdraw"]),
  closedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date").transform((s) => new Date(`${s}T00:00:00Z`)),
  reason: z.string().trim().max(200).default(""),
});

/**
 * Premature closure (every product except mutual funds) or a mutual fund withdrawal. Bills and reminders
 * stop: unpaid instalments become Stopped, paid history stays. No money moves in the Day Book – the
 * partner pays the customer directly.
 */
export async function closePolicy(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Policy.Create");
  const parsed = closeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const policy = await db.policy.findFirst({ where: { id: v.policyId, tenantId: user.tenantId }, include: { product: true, customer: { select: { id: true, name: true } } } });
  if (!policy) return fail("This policy no longer exists");
  if (!canActOn(user, policy.ownerId)) return fail("This policy belongs to another user's customer");
  if (policy.status !== "Active") return fail(`This policy is already ${policy.status === "PrematureClosed" ? "closed early" : policy.status.toLowerCase()}`);
  const isMf = policy.productType === "MutualFund";
  if (isMf && v.kind === "close") return fail("Mutual funds are withdrawn, not closed early – enter the withdraw date");
  if (!isMf && v.kind === "withdraw") return fail("Only mutual funds are withdrawn; use premature closure");
  if (v.kind === "close" && v.reason.length < 3) return fail("Enter the reason for closing early", { reason: "Required" });
  if (v.closedOn > istToday()) return fail("The date can't be in the future");
  if (v.closedOn < policy.startDate) return fail(`The date can't be before the start date (${fmtDate(policy.startDate)})`);
  if (v.kind === "close" && policy.product) {
    if (!policy.product.prematureClosure) return fail(`${policy.product.name} can't be closed early (Settings → Products and schemes)`);
    const lockIn = lockInUntil(policy.startDate, policy.product.lockInMonths);
    if (lockIn && v.closedOn < lockIn && !policy.product.closeDuringLockIn) return fail(`Lock-in runs until ${fmtDate(lockIn)}; it can't be closed before then`);
  }

  const status = v.kind === "close" ? "PrematureClosed" : "Withdrawn";
  const label = v.kind === "close" ? "Closed early" : "Withdrawn";
  await db.$transaction(async (tx) => {
    const updated = await tx.policy.updateMany({ where: { id: policy.id, status: "Active" }, data: { status, closedOn: v.closedOn, closeReason: v.reason || null } });
    if (updated.count !== 1) throw new Error("The policy changed while saving; reload and try again");
    const stopped = await tx.renewalItem.updateMany({ where: { policyId: policy.id, status: { in: ["Due", "Overdue"] } }, data: { status: "Stopped" } });
    await audit(tx, user, {
      entity: "Policy", entityId: policy.id, action: label,
      summary: `${policy.customer.name} · ${policy.partner} ${policy.productName} ${policy.policyNumber} ${label.toLowerCase()} on ${fmtDate(v.closedOn)}${stopped.count ? ` · ${stopped.count} unpaid instalment(s) stopped` : ""}`,
      before: { status: "Active" },
      after: { status: label, date: fmtDate(v.closedOn) },
      reason: v.reason || null,
    });
  });
  revalidatePath(`/customers/${policy.customer.id}`);
  revalidatePath("/renewals");
  return { ok: true };
}

// ── Add product directly (no quotation) ──

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter the amount");
const yearsField = z.string().trim().regex(/^(\d{1,2}(\.5)?)?$/, "Years must be a number like 5 or 2.5").transform((v) => (v ? Math.round(Number(v) * 12) : null));
const addSchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().min(1, "Pick the product"),
  schemeId: z.string().default(""),
  policyNumber: z.string().trim().toUpperCase().max(40).default(""),
  amount: money.refine((v) => Number(v) > 0, "Amount must be more than 0"),
  sumAssured: z.union([z.literal(""), money]).default(""),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date of commencement").transform((v) => new Date(`${v}T00:00:00Z`)),
  frequency: z.enum(Frequency, "Pick the pay mode"),
  term: yearsField.default(null),
  premiumPayingTerm: yearsField.default(null),
  nominee: z.string().trim().max(80).default(""),
  sipDay: z.string().default(""),
  folioNo: z.string().trim().toUpperCase().max(40, "Folio number is too long").default(""),
  firstHolderCif: z.string().trim().toUpperCase().max(40, "CIF is too long").default(""), // post office only
});

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MICR = /^\d{9}$/;

/**
 * "Add product directly" on a customer: every rule comes from Settings → Products and schemes (pay modes, shown /
 * required fields, bank details, custom fields). With a policy number it is saved as an Active policy with its
 * renewal schedule; without one it waits in Proposals (no consent step – the customer already exists).
 */
export async function addProductDirect(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Policy.Create");
  const parsed = addSchema.safeParse(Object.fromEntries([...form.entries()].filter(([k]) => !k.startsWith("cf_") && !k.startsWith("bank_"))));
  if (!parsed.success) return fail(parsed.error.issues[0].message, { [String(parsed.error.issues[0].path[0])]: parsed.error.issues[0].message });
  const v = parsed.data;

  const customer = await db.customer.findFirst({ where: { id: v.customerId, tenantId: user.tenantId } });
  if (!customer) return fail("Customer not found");
  if (!canActOn(user, customer.ownerId)) return fail("This customer belongs to another user");
  const product = await db.product.findFirst({
    where: { id: v.productId, tenantId: user.tenantId, active: true },
    include: { schemes: { where: { active: true }, include: { rates: true } }, customFields: { orderBy: { sort: "asc" } } },
  });
  if (!product) return fail("Pick an active product");
  const scheme = product.schemes.find((s) => s.id === v.schemeId) ?? null;
  if (product.schemes.length > 0 && !scheme) return fail("Pick the scheme", { schemeId: "Required" });
  if (!product.payModes.includes(v.frequency)) return fail(`${product.name} is paid ${product.payModes.map((m) => PAY_MODE_LABEL[m].toLowerCase()).join(" or ")}`, { frequency: "Not allowed" });
  if (v.startDate > addMonths(istToday(), 1)) return fail("Date of commencement can't be more than a month ahead", { startDate: "Too far ahead" });
  // Mutual fund SIP: the SIP date (1–28) is required; bills fall on it.
  const sipDay = needsSipDay(product.productType, v.frequency) ? Number(v.sipDay) : null;
  if (sipDay !== null && !(Number.isInteger(sipDay) && sipDay >= 1 && sipDay <= 28)) return fail("Pick the SIP date (1–28)", { sipDay: "Required" });

  const shown = (f: string) => product.fields.includes(f);
  const needed = (f: string) => product.requiredFields.includes(f);
  const termMonths = scheme?.tenureMonths ?? v.term;
  if (needed("premiumPayingTerm") && !v.premiumPayingTerm) return fail("Enter the premium paying term", { premiumPayingTerm: "Required" });
  if (v.premiumPayingTerm && termMonths && v.premiumPayingTerm > termMonths) return fail("Premium paying term can't be longer than the term", { premiumPayingTerm: "Too long" });
  if (needed("nominee") && !v.nominee) return fail("Enter the nominee", { nominee: "Required" });
  // Insurance saved straight as a policy needs DOC, sum assured, plan, premium (+ term, PPT for life) – owner, 3 Nov 2026.
  if (v.policyNumber && product.productType === "Insurance") {
    const missing = missingInsuranceDetails({
      health: isHealthCover({ invoiceRule: product.invoiceRule }), hasPlans: product.schemes.length > 0, pptShown: shown("premiumPayingTerm"),
      startDate: v.startDate, sumAssured: v.sumAssured, schemeId: scheme?.id, termMonths, premiumPayingTermMonths: v.premiumPayingTerm, premiumOk: Number(v.amount) > 0,
    });
    if (missing.length) {
      const field: Record<string, string> = { "sum assured": "sumAssured", term: "term", "premium paying term": "premiumPayingTerm", plan: "schemeId" };
      return fail(`Fill in before the policy number: ${missing.join(", ")}`, Object.fromEntries(missing.filter((m) => field[m]).map((m) => [field[m], "Required"])));
    }
  }

  // Post office: the holder's CIF from the post office (optional), unique within the company like on proposals.
  const firstHolderCif = isPostal(product) ? v.firstHolderCif || null : null;
  if (firstHolderCif) {
    const duplicate = await duplicateCompanyCif(db, user.tenantId, product.partner, firstHolderCif, { customerId: customer.id, mobile: customer.mobile }, "");
    if (duplicate) return { ok: false, error: `${firstHolderCif}: ${duplicateMessage(duplicate)}`, duplicate, fieldErrors: { firstHolderCif: "Already used" } };
  }

  // Custom fields: cf_<id>
  const customValues: Record<string, string | number> = {};
  for (const f of product.customFields) {
    const raw = String(form.get(`cf_${f.id}`) ?? "").trim();
    if (!raw) {
      if (f.required) return fail(`Enter ${f.label}`, { [`cf_${f.id}`]: "Required" });
      continue;
    }
    if (f.type === "Number" && !/^-?\d+(\.\d+)?$/.test(raw)) return fail(`${f.label} must be a number`, { [`cf_${f.id}`]: "Number" });
    if (f.type === "Date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail(`${f.label} must be a date`, { [`cf_${f.id}`]: "Date" });
    if (f.type === "Dropdown" && !f.options.includes(raw)) return fail(`Pick ${f.label} from the list`, { [`cf_${f.id}`]: "Pick" });
    customValues[f.label] = f.type === "Number" ? Number(raw) : raw;
  }

  // Bank details: bank_<field>, encrypted
  let bankDetailsEnc: string | null = null;
  if (product.bankDetailsRequired) {
    const bank: Record<string, string> = {};
    for (const k of product.bankFields as BankField[]) {
      const raw = String(form.get(`bank_${k}`) ?? "").trim().toUpperCase();
      if (!raw) return fail(`Enter the ${BANK_FIELDS[k].toLowerCase()}`, { [`bank_${k}`]: "Required" });
      if (k === "ifsc" && !IFSC.test(raw)) return fail("IFSC looks like SBIN0001234", { bank_ifsc: "Format" });
      if (k === "micr" && !MICR.test(raw)) return fail("MICR code is 9 digits", { bank_micr: "Format" });
      if (k === "accountNo" && !/^\d{6,18}$/.test(raw)) return fail("Account number should be 6–18 digits", { bank_accountNo: "Format" });
      if (k === "accountType" && raw !== "SAVINGS" && raw !== "CURRENT") return fail("Pick Savings or Current", { bank_accountType: "Pick" });
      bank[k] = k === "holder" || k === "bank" || k === "branch" ? String(form.get(`bank_${k}`)).trim() : k === "accountType" ? (raw === "SAVINGS" ? "Savings" : "Current") : raw;
    }
    try {
      bankDetailsEnc = encryptJson(bank);
    } catch (e) {
      if (e instanceof EncryptionKeyMissing) return fail(e.message);
      throw e;
    }
  }

  const details = {
    productType: product.productType, partner: product.partner,
    // Post office accounts show their scheme ("TD 5 years"); insurance and funds their product name.
    productName: product.productType === "Insurance" || product.productType === "MutualFund" || !scheme ? product.name : scheme.name,
    productId: product.id, schemeId: scheme?.id ?? null, frequency: v.frequency, startDate: v.startDate, sipDay, folioNo: product.productType === "MutualFund" ? v.folioNo || null : null, firstHolderCif, termMonths,
    premiumPayingTermMonths: shown("premiumPayingTerm") ? v.premiumPayingTerm : null, nominee: shown("nominee") ? v.nominee || null : null,
    rateAtOpen: scheme ? rateOn(scheme.rates, v.startDate)?.rate ?? null : null,
    customValues: Object.keys(customValues).length ? customValues : undefined, bankDetailsEnc,
  };

  try {
    if (v.policyNumber) {
      const policy = await db.$transaction((tx) => createPolicyWithSchedule(tx, {
        tenantId: user.tenantId, customerId: customer.id, ownerId: customer.ownerId, policyNumber: v.policyNumber, premiumAmount: v.amount,
        sumAssured: v.sumAssured || null, invoiceRule: product.invoiceRule, ...details,
      }));
      revalidatePath("/", "layout");
      return { ok: true, id: policy.id, href: `/customers/${customer.id}`, message: `${details.productName} ${v.policyNumber} added as Active` };
    }
    const { partner, ...proposalDetails } = details;
    const proposal = await db.$transaction(async (tx) => tx.proposal.create({
      data: {
        tenantId: user.tenantId, proposalNo: await nextNumber(tx, user.tenantId, "proposal"), customerId: customer.id, customerName: customer.name,
        mobile: customer.mobile, insurer: partner, premium: v.amount, sumInsured: v.sumAssured || null, status: "Draft", ownerId: customer.ownerId, ...proposalDetails,
      },
    }));
    revalidatePath("/", "layout");
    return { ok: true, id: proposal.id, href: `/proposals/${proposal.id}`, message: `Saved as proposal ${proposal.proposalNo} – enter the policy number when it is issued` };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(`Policy number ${v.policyNumber} already exists`, { policyNumber: "Duplicate" });
    throw e;
  }
}

// ── Customer details ──

const customerSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().trim().min(2, "Enter the name").max(80),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  address: z.string().trim().max(300),
});

/** Correct a customer's name, mobiles, email and address. Owner or Admin; the change log keeps the old values. */
export async function editCustomer(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Policy.Create");
  const parsed = customerSchema.safeParse({ customerId: form.get("customerId"), name: form.get("name") ?? "", email: form.get("email") ?? "", address: form.get("address") ?? "" });
  if (!parsed.success) return fail(parsed.error.issues[0].message, { [String(parsed.error.issues[0].path[0])]: parsed.error.issues[0].message });
  const v = parsed.data;
  const m = readMobiles(form);
  if ("error" in m) return fail(m.error, { mobile: m.error });
  const c = await db.customer.findFirst({ where: { id: v.customerId, tenantId: user.tenantId }, include: { mobiles: { orderBy: { sort: "asc" } } } });
  if (!c) return fail("Customer not found");
  if (!canActOn(user, c.ownerId)) return fail("This customer belongs to another user");

  await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: c.id }, data: { name: v.name, email: v.email || null, address: v.address || null, mobile: m.numbers[0].number } });
    await tx.customerMobile.deleteMany({ where: { customerId: c.id } });
    await tx.customerMobile.createMany({ data: m.numbers.map((n, sort) => ({ tenantId: user.tenantId, customerId: c.id, number: n.number, isWhatsApp: n.isWhatsApp, sort })) });
    const snap = (x: { name: string; email: string | null; address: string | null }, ms: { number: string; isWhatsApp: boolean }[]) => ({ name: x.name, mobiles: mobilesText(ms), email: x.email, address: x.address });
    const diff = changedOnly(snap(c, c.mobiles), snap({ name: v.name, email: v.email || null, address: v.address || null }, m.numbers));
    if (Object.keys(diff.after).length) await audit(tx, user, { entity: "Customer", entityId: c.id, action: "Updated", summary: `Customer ${v.name} details corrected`, ...diff });
  });
  revalidatePath(`/customers/${c.id}`);
  revalidatePath("/customers");
  return { ok: true };
}

/** "Change photo" on the customer record: JPG / PNG up to 2 MB, logged. */
export async function changeCustomerPhoto(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Policy.View");
  const customerId = String(form.get("customerId") ?? "");
  const file = form.get("photo");
  const photo = file instanceof File ? file : null;
  const problem = photoProblem(photo);
  if (problem) return fail(problem, { photo: problem });
  const c = await db.customer.findFirst({ where: { id: customerId, tenantId: user.tenantId } });
  if (!c) return fail("Customer not found");
  if (!canActOn(user, c.ownerId)) return fail("This customer belongs to another user");
  const name = await savePhoto(photo!, c.id, c.photoPath);
  await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: c.id }, data: { photoPath: name } });
    await audit(tx, user, { entity: "Customer", entityId: c.id, action: "Photo", summary: `${c.cifNo} ${c.name}: photo ${c.photoPath ? "changed" : "added"}` });
  });
  revalidatePath(`/customers/${c.id}`);
  return { ok: true };
}

const identitySchema = z.object({
  customerId: z.string().min(1),
  consent: z.string().default(""),
  pan: z.string().trim().toUpperCase().pipe(z.union([z.literal(""), z.string().regex(PAN_RE, "PAN looks like ABCDE1234F")])),
  aadhaar: z.string().transform((v) => v.replace(/[\s-]/g, "")).pipe(z.union([z.literal(""), z.string().regex(AADHAAR_RE, "Aadhaar has 12 digits")])),
});

/**
 * Aadhaar / PAN on the customer page (#1, #13, #28): only after "Customer consent taken"; full numbers encrypted;
 * one that already belongs to another customer is refused with their details for the pop-up.
 */
export async function saveCustomerIdentity(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("PII.Edit");
  const parsed = identitySchema.safeParse({ customerId: form.get("customerId"), consent: form.get("consent") ?? "", pan: form.get("pan") ?? "", aadhaar: form.get("aadhaar") ?? "" });
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
  }
  const { customerId, pan, aadhaar } = parsed.data;
  try {
    const res = await db.$transaction(async (tx): Promise<ActionResult> => {
      const c = await tx.customer.findFirst({ where: { id: customerId, tenantId: user.tenantId } });
      if (!c) return { ok: false, error: "Customer not found" };
      if (!canActOn(user, c.ownerId)) return { ok: false, error: "This customer belongs to another user" };
      const consentNow = !c.consentAt && parsed.data.consent === "on";
      if (!c.consentAt && !consentNow) return { ok: false, error: "Tick “Customer consent taken” first", fieldErrors: { consent: "Required" } };
      const consent = consentNow ? { consentAt: new Date(), consentById: user.id } : {};
      if (!pan && !aadhaar) {
        if (!consentNow) return { ok: false, error: "Enter the Aadhaar or PAN to save" };
        await tx.customer.update({ where: { id: c.id }, data: consent });
        await audit(tx, user, { entity: "Customer", entityId: c.id, action: "Consent", summary: `${c.name} (${c.cifNo}): customer consent taken` });
        return { ok: true, message: "Consent recorded" };
      }
      const data = identityData(aadhaar, pan);
      const duplicate = await duplicateIdentity(tx, user.tenantId, { aadhaarHash: data.aadhaarHash, panHash: data.panHash }, { customerId: c.id, mobile: c.mobile });
      if (duplicate) return { ok: false, error: duplicateMessage(duplicate), duplicate };
      await tx.customer.update({ where: { id: c.id }, data: { ...data, ...consent } });
      await audit(tx, user, {
        entity: "Customer", entityId: c.id, action: "Updated",
        summary: `${c.name} (${c.cifNo}): ${[aadhaar && `Aadhaar XXXX-XXXX-${aadhaar.slice(-4)}`, pan && `PAN ${maskPan(pan)}`].filter(Boolean).join(" · ")}${consentNow ? " · consent taken" : ""}`,
      });
      return { ok: true };
    });
    if (res.ok) revalidatePath(`/customers/${customerId}`);
    return res;
  } catch (e) {
    if (e instanceof EncryptionKeyMissing) return { ok: false, error: e.message.replace("Bank details", "Aadhaar / PAN") };
    // Two people saving the same number at once: the database keeps only one.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, error: "That Aadhaar / PAN was just saved on another customer; reload and check" };
    throw e;
  }
}
