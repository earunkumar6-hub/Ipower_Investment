"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { audit } from "@/lib/audit";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { isSlabService, ratesInForce } from "@/lib/esevai";
import { D, fmtINR } from "@/lib/money";
import { authorize } from "@/lib/session";

// Settings → ESEVAI & CSC rates (owner change list, #46). A rate is never edited: a new rate with a start date
// takes over from that day, so older entries keep the rate they were made with. Every change is logged.

const fail = (error: string, field?: string): ActionResult => ({ ok: false, error, fieldErrors: field ? { [field]: error } : undefined });
const done = (): ActionResult => {
  revalidatePath("/settings/esevai-rates");
  revalidatePath("/esevai");
  return { ok: true };
};
const money = (label: string) => z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, `Enter ${label}`);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date").transform((s) => new Date(`${s}T00:00:00Z`));

const rateSchema = z.object({
  serviceTypeId: z.string().min(1),
  effectiveFrom: isoDay,
  // Slab services (EB): the bill range and the charge added to the bill.
  minAmount: z.string().trim().default(""),
  maxAmount: z.string().trim().default(""),
  serviceCharge: z.string().trim().default(""),
  // Fixed services (PAN, certificate): what is paid / deducted and what the customer pays.
  walletCost: z.string().trim().default(""),
  fixedCustomerAmount: z.string().trim().default(""),
});

/** Add a rate that starts on a date. The same slab (or the fixed rate) with the same start date is replaced. */
export async function saveServiceRate(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = rateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message, String(parsed.error.issues[0].path[0]));
  const v = parsed.data;
  return db.$transaction(async (tx) => {
    const type = await tx.serviceType.findFirst({ where: { id: v.serviceTypeId, tenantId: user.tenantId } });
    if (!type) return fail("Service not found");
    if (type.code === "OTHER") return fail("Other services have no rate – staff type the amounts on each entry");

    if (isSlabService(type.code)) {
      for (const [field, label] of [["minAmount", "the bill amount from"], ["maxAmount", "the bill amount to"], ["serviceCharge", "the service charge"]] as const) {
        const r = money(label).safeParse(v[field]);
        if (!r.success) return fail(r.error.issues[0].message, field);
      }
      const min = new D(v.minAmount), max = new D(v.maxAmount), charge = new D(v.serviceCharge);
      if (max.lt(min)) return fail("\"To\" can't be less than \"From\"", "maxAmount");
      // Another slab in force on that day must not cover part of the same bill range.
      const inForce = await ratesInForce(tx, type.id, v.effectiveFrom);
      const clash = inForce.find((r) => r.minAmount && r.maxAmount && !(r.minAmount.equals(min) && r.maxAmount.equals(max)) && min.lte(r.maxAmount) && max.gte(r.minAmount));
      if (clash) return fail(`Overlaps the slab ${fmtINR(clash.minAmount!)} – ${fmtINR(clash.maxAmount!)}. Use the same From / To to change that slab's charge.`, "minAmount");
      const same = await tx.serviceRate.findFirst({ where: { serviceTypeId: type.id, minAmount: min, maxAmount: max, effectiveFrom: v.effectiveFrom } });
      const data = { minAmount: min, maxAmount: max, serviceCharge: charge, walletCost: null, fixedCustomerAmount: null };
      const row = same ? await tx.serviceRate.update({ where: { id: same.id }, data }) : await tx.serviceRate.create({ data: { ...data, serviceTypeId: type.id, effectiveFrom: v.effectiveFrom } });
      await audit(tx, user, {
        entity: "ServiceRate", entityId: row.id, action: same ? "Updated" : "Created",
        summary: `${type.name}: bills ${fmtINR(min)} – ${fmtINR(max)} service charge ${fmtINR(charge)} from ${fmtDate(v.effectiveFrom)}`,
      });
      return done();
    }

    for (const [field, label] of [["walletCost", "the amount paid / deducted"], ["fixedCustomerAmount", "the amount collected from the customer"]] as const) {
      const r = money(label).safeParse(v[field]);
      if (!r.success) return fail(r.error.issues[0].message, field);
    }
    const cost = new D(v.walletCost), customer = new D(v.fixedCustomerAmount);
    if (customer.lt(cost)) return fail("Collected from the customer can't be less than the amount paid", "fixedCustomerAmount");
    const same = await tx.serviceRate.findFirst({ where: { serviceTypeId: type.id, minAmount: null, maxAmount: null, effectiveFrom: v.effectiveFrom } });
    const data = { minAmount: null, maxAmount: null, serviceCharge: null, walletCost: cost, fixedCustomerAmount: customer };
    const row = same ? await tx.serviceRate.update({ where: { id: same.id }, data }) : await tx.serviceRate.create({ data: { ...data, serviceTypeId: type.id, effectiveFrom: v.effectiveFrom } });
    await audit(tx, user, {
      entity: "ServiceRate", entityId: row.id, action: same ? "Updated" : "Created",
      summary: `${type.name}: paid ${fmtINR(cost)}, collected ${fmtINR(customer)}, service charge ${fmtINR(customer.minus(cost))} from ${fmtDate(v.effectiveFrom)}`,
    });
    return done();
  });
}

/** Remove a rate that has not started yet (entered by mistake). A rate already in force is replaced by a newer one instead. */
export async function deleteServiceRate(id: string): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  return db.$transaction(async (tx) => {
    const r = await tx.serviceRate.findFirst({ where: { id, serviceType: { tenantId: user.tenantId } }, include: { serviceType: true } });
    if (!r) return fail("Not found");
    if (r.effectiveFrom <= istToday()) return fail("This rate has already started – add a new rate with a later start date instead");
    await tx.serviceRate.delete({ where: { id } });
    await audit(tx, user, { entity: "ServiceRate", entityId: id, action: "Deleted", summary: `${r.serviceType.name}: rate starting ${fmtDate(r.effectiveFrom)} removed before it started` });
    return done();
  });
}
