"use server";

import { CustomFieldType, Frequency, InvoiceRule, Prisma, ProductType, type Product } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { audit, changedOnly } from "@/lib/audit";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { ACCOUNT_FIELDS, BANK_FIELDS, fmtTenure, PAY_MODE_LABEL, PRODUCT_TYPE_LABEL, rateOn } from "@/lib/products";
import { authorize } from "@/lib/session";

// Settings → Products and schemes (Admin and Super Admin). Every change is written to the change log.

const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({ ok: false, error, fieldErrors });
const done = (path: string, extra?: Partial<ActionResult>): ActionResult => {
  revalidatePath("/settings", "layout");
  revalidatePath(path);
  return { ok: true, ...extra };
};
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const months = z.string().trim().regex(/^\d{0,3}$/, "Months must be a whole number").transform((s) => (s ? Number(s) : null));
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").transform((s) => new Date(`${s}T00:00:00Z`));
const keysOf = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

const productSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the product name").max(80),
  productType: z.enum(ProductType),
  partner: z.string().trim().min(2, "Enter the partner (insurer, AMC or Post Office)").max(60),
  invoiceRule: z.enum(InvoiceRule),
  payModes: z.array(z.enum(Frequency)).min(1, "Tick at least one pay mode"),
  lockInMonths: months,
  bankDetailsRequired: z.boolean(),
  bankFields: z.array(z.enum(keysOf(BANK_FIELDS))),
  prematureClosure: z.boolean(),
  fields: z.array(z.enum(keysOf(ACCOUNT_FIELDS))),
  requiredFields: z.array(z.enum(keysOf(ACCOUNT_FIELDS))),
  active: z.boolean(),
});

/** What the change log shows for a product: readable values only. */
const productSnapshot = (p: Pick<Product, "name" | "productType" | "partner" | "invoiceRule" | "payModes" | "lockInMonths" | "bankDetailsRequired" | "bankFields" | "prematureClosure" | "fields" | "requiredFields" | "active">) => ({
  name: p.name,
  type: PRODUCT_TYPE_LABEL[p.productType],
  partner: p.partner,
  bills: p.invoiceRule,
  payModes: p.payModes.map((m) => PAY_MODE_LABEL[m]).join(", "),
  lockIn: p.lockInMonths ? fmtTenure(p.lockInMonths) : "none",
  bankDetails: p.bankDetailsRequired ? p.bankFields.map((f) => BANK_FIELDS[f as keyof typeof BANK_FIELDS]).join(", ") : "not needed",
  prematureClosure: p.prematureClosure ? "allowed" : "not allowed",
  fields: p.fields.map((f) => `${ACCOUNT_FIELDS[f as keyof typeof ACCOUNT_FIELDS]}${p.requiredFields.includes(f) ? " *" : ""}`).join(", "),
  active: p.active ? "yes" : "no",
});

export async function saveProduct(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = productSchema.safeParse({
    id: form.get("id") || undefined,
    name: form.get("name"),
    productType: form.get("productType"),
    partner: form.get("partner"),
    invoiceRule: form.get("invoiceRule"),
    payModes: form.getAll("payModes"),
    lockInMonths: form.get("lockInMonths") ?? "",
    bankDetailsRequired: form.get("bankDetailsRequired") === "on",
    bankFields: form.getAll("bankFields"),
    prematureClosure: form.get("prematureClosure") === "on",
    fields: form.getAll("fields"),
    requiredFields: form.getAll("requiredFields"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  if (v.requiredFields.some((f) => !v.fields.includes(f))) return fail("A required field must also be shown – tick it under 'Shown'");
  if (v.bankDetailsRequired && v.bankFields.length === 0) return fail("Tick the bank fields this product needs");
  if (v.invoiceRule !== "None" && v.payModes.every((m) => m === "OneTime")) return fail("A product with bills needs a pay mode other than one-time");
  if (v.invoiceRule === "None" && v.payModes.some((m) => m !== "OneTime") && v.productType !== "MutualFund") {
    return fail("Products with no bills are one-time deposits; pick One-time only, or choose a bill rule");
  }
  // Mutual funds are never closed early: they are withdrawn (withdraw date).
  const data = { ...v, id: undefined, bankFields: v.bankDetailsRequired ? v.bankFields : [], prematureClosure: v.productType === "MutualFund" ? false : v.prematureClosure };

  try {
    return await db.$transaction(async (tx) => {
      if (!v.id) {
        const p = await tx.product.create({ data: { ...data, tenantId: user.tenantId } });
        await audit(tx, user, { entity: "Product", entityId: p.id, action: "Created", summary: `Product ${p.partner} · ${p.name} added`, after: productSnapshot(p) });
        return done("/settings", { id: p.id, href: `/settings/products/${p.id}` });
      }
      const before = await tx.product.findFirst({ where: { id: v.id, tenantId: user.tenantId } });
      if (!before) return fail("This product no longer exists");
      const after = await tx.product.update({ where: { id: before.id }, data });
      const diff = changedOnly(productSnapshot(before), productSnapshot(after));
      if (Object.keys(diff.after).length) {
        await audit(tx, user, { entity: "Product", entityId: after.id, action: "Updated", summary: `Product ${after.partner} · ${after.name} changed`, ...diff });
      }
      return done(`/settings/products/${after.id}`);
    });
  } catch (e) {
    if (isUnique(e)) return fail(`${v.partner} already has a product named ${v.name}`, { name: "Duplicate" });
    throw e;
  }
}

const schemeSchema = z.object({
  productId: z.string().min(1),
  schemeId: z.string().optional(),
  name: z.string().trim().min(1, "Enter the scheme / plan name").max(60),
  tenure: z.string().trim().regex(/^\d{0,3}$/, "Tenure must be a whole number"),
  tenureUnit: z.enum(["years", "months"]),
  active: z.boolean(),
  rate: z.string().trim().regex(/^(\d{1,2}(\.\d{1,2})?)?$/, "Rate must be like 7.5"),
  effectiveFrom: z.string().optional(),
});

/** Add or edit a scheme. A new scheme can carry its first interest rate; later changes go through `addRate`. */
export async function saveScheme(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = schemeSchema.safeParse({
    productId: form.get("productId"),
    schemeId: form.get("schemeId") || undefined,
    name: form.get("name"),
    tenure: form.get("tenure") ?? "",
    tenureUnit: form.get("tenureUnit") ?? "years",
    active: form.get("active") !== "off",
    rate: form.get("rate") ?? "",
    effectiveFrom: (form.get("effectiveFrom") as string) || undefined,
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  const tenureMonths = v.tenure ? Number(v.tenure) * (v.tenureUnit === "years" ? 12 : 1) : null;
  if (tenureMonths === 0) return fail("Tenure must be more than 0 (leave it blank for open-ended)");
  const product = await db.product.findFirst({ where: { id: v.productId, tenantId: user.tenantId } });
  if (!product) return fail("This product no longer exists");
  const path = `/settings/products/${product.id}`;

  try {
    return await db.$transaction(async (tx) => {
      if (!v.schemeId) {
        if (v.rate && !v.effectiveFrom) return fail("Pick the date the rate applies from");
        const s = await tx.scheme.create({ data: { productId: product.id, name: v.name, tenureMonths } });
        if (v.rate) await tx.schemeRate.create({ data: { schemeId: s.id, rate: v.rate, effectiveFrom: isoDay.parse(v.effectiveFrom), changedById: user.id } });
        await audit(tx, user, {
          entity: "Scheme", entityId: s.id, action: "Created", summary: `Scheme ${s.name} added to ${product.name}`,
          after: { tenure: fmtTenure(tenureMonths), ...(v.rate && { rate: `${v.rate}% from ${fmtDate(isoDay.parse(v.effectiveFrom))}` }) },
        });
        return done(path);
      }
      const before = await tx.scheme.findFirst({ where: { id: v.schemeId, productId: product.id } });
      if (!before) return fail("This scheme no longer exists");
      const after = await tx.scheme.update({ where: { id: before.id }, data: { name: v.name, tenureMonths, active: v.active } });
      const snap = (s: typeof before) => ({ name: s.name, tenure: fmtTenure(s.tenureMonths), active: s.active ? "yes" : "no" });
      const diff = changedOnly(snap(before), snap(after));
      if (Object.keys(diff.after).length) await audit(tx, user, { entity: "Scheme", entityId: after.id, action: "Updated", summary: `Scheme ${after.name} of ${product.name} changed`, ...diff });
      return done(path);
    });
  } catch (e) {
    if (isUnique(e)) return fail(`${product.name} already has a scheme named ${v.name}`, { name: "Duplicate" });
    throw e;
  }
}

const rateSchema = z.object({
  schemeId: z.string().min(1),
  rate: z.string().trim().regex(/^\d{1,2}(\.\d{1,2})?$/, "Enter the interest rate, like 7.5"),
  effectiveFrom: isoDay,
});

/** A new interest rate from a date. History is kept; accounts already opened keep the rate they were opened at. */
export async function addRate(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = rateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  const scheme = await db.scheme.findFirst({ where: { id: v.schemeId, product: { tenantId: user.tenantId } }, include: { product: true, rates: true } });
  if (!scheme) return fail("This scheme no longer exists");
  if (scheme.rates.some((r) => r.effectiveFrom.getTime() === v.effectiveFrom.getTime())) {
    return fail(`A rate from ${fmtDate(v.effectiveFrom)} is already set; pick another date`);
  }
  const previous = rateOn(scheme.rates, v.effectiveFrom);
  await db.$transaction(async (tx) => {
    await tx.schemeRate.create({ data: { schemeId: scheme.id, rate: v.rate, effectiveFrom: v.effectiveFrom, changedById: user.id } });
    await audit(tx, user, {
      entity: "Scheme", entityId: scheme.id, action: "Rate changed",
      summary: `${scheme.product.name} · ${scheme.name}: ${v.rate}% from ${fmtDate(v.effectiveFrom)}`,
      before: { rate: previous ? `${previous.rate.toFixed(2)}%` : "none" },
      after: { rate: `${new Prisma.Decimal(v.rate).toFixed(2)}%`, from: fmtDate(v.effectiveFrom) },
    });
  });
  return done(`/settings/products/${scheme.productId}`);
}

const customFieldSchema = z.object({
  productId: z.string().min(1),
  label: z.string().trim().min(2, "Enter the field name").max(40),
  type: z.enum(CustomFieldType),
  options: z.string().trim().max(400).default(""),
  required: z.boolean(),
});

export async function addCustomField(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = customFieldSchema.safeParse({ ...Object.fromEntries(form), required: form.get("required") === "on" });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  const options = v.type === "Dropdown" ? [...new Set(v.options.split(",").map((o) => o.trim()).filter(Boolean))] : [];
  if (v.type === "Dropdown" && options.length < 2) return fail("A dropdown needs at least two values, separated by commas");
  const product = await db.product.findFirst({ where: { id: v.productId, tenantId: user.tenantId }, include: { customFields: true } });
  if (!product) return fail("This product no longer exists");
  try {
    await db.$transaction(async (tx) => {
      const f = await tx.productCustomField.create({
        data: { productId: product.id, label: v.label, type: v.type, options, required: v.required, sort: product.customFields.length },
      });
      await audit(tx, user, {
        entity: "Product", entityId: product.id, action: "Custom field added", summary: `${product.name}: field ${f.label} added`,
        after: { field: f.label, type: f.type, ...(options.length && { values: options.join(", ") }), required: f.required ? "yes" : "no" },
      });
    });
  } catch (e) {
    if (isUnique(e)) return fail(`${product.name} already has a field named ${v.label}`);
    throw e;
  }
  return done(`/settings/products/${product.id}`);
}

/** Custom field values aren't stored on accounts yet (phase 3), so removing a field loses nothing. */
export async function removeCustomField(fieldId: string): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const f = await db.productCustomField.findFirst({ where: { id: fieldId, product: { tenantId: user.tenantId } }, include: { product: true } });
  if (!f) return fail("This field no longer exists");
  await db.$transaction(async (tx) => {
    await tx.productCustomField.delete({ where: { id: f.id } });
    await audit(tx, user, {
      entity: "Product", entityId: f.productId, action: "Custom field removed", summary: `${f.product.name}: field ${f.label} removed`,
      before: { field: f.label, type: f.type, ...(f.options.length && { values: f.options.join(", ") }), required: f.required ? "yes" : "no" },
    });
  });
  return done(`/settings/products/${f.productId}`);
}
