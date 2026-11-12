"use server";

import type { Duplicate } from "@/lib/identity";

import { Gender, LeadSource, LeadStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, changedOnly } from "@/lib/audit";
import { fmtDmy, istToday, parseIstDateTime } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { GENDER_LABEL, LEAD_SOURCE_LABEL } from "@/lib/lead-labels";
import { canActOn } from "@/lib/leads";
import { readMobiles } from "@/lib/mobiles";
import { nextNumber } from "@/lib/numbering";
import { seesAll } from "@/lib/permissions";
import { authorize, type SessionUser } from "@/lib/session";

export type ActionResult = {
  ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; id?: string; href?: string;
  /** Aadhaar / PAN / company CIF already belongs to someone else (#28 pop-up). */
  duplicate?: Duplicate;
  /** Expenses: the same vendor's bill number is already entered (#42 pop-up). */
  duplicateBill?: { expenseNo: string; date: string; amount: string; vendor: string; billNo: string };
};

const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({ ok: false, error, fieldErrors });

function fieldErrors(error: z.ZodError) {
  return Object.fromEntries(error.issues.map((i) => [String(i.path[0]), i.message]));
}

/** "2026-10-15" + "11:00" (IST) → Date in the future, or an error message. */
function futureTime(date: string, time: string): Date | string {
  const at = parseIstDateTime(`${date}T${time}`);
  if (!at) return "Pick a date and time";
  if (at.getTime() <= Date.now()) return "Pick a time in the future";
  return at;
}

const optionalCall = (date: string, time: string): Date | string | null => (date || time ? futureTime(date, time) : null);

// ── Lead details (add and edit) ──

const detailsSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the first name").max(60),
  lastName: z.string().trim().max(60),
  dob: z.iso.date("Enter the date of birth").refine((d) => d >= "1900-01-01" && new Date(`${d}T00:00:00Z`) < istToday(), "Date of birth must be in the past"),
  gender: z.enum(Gender, "Pick the gender"),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  address: z.string().trim().max(300),
  source: z.enum(LeadSource, "Pick the business type"),
  referrerName: z.string().trim().max(80),
  interest: z.string().trim().max(200),
  notes: z.string().trim().max(1000),
});
type Details = z.infer<typeof detailsSchema>;

function parseDetails(form: FormData) {
  const parsed = detailsSchema.safeParse({
    firstName: form.get("firstName") ?? "", lastName: form.get("lastName") ?? "", dob: form.get("dob") ?? "", gender: form.get("gender") || undefined,
    email: form.get("email") ?? "", address: form.get("address") ?? "", source: form.get("source") || undefined, referrerName: form.get("referrerName") ?? "",
    interest: form.get("interest") ?? "", notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { error: fail("Check the highlighted fields", fieldErrors(parsed.error)) };
  if (parsed.data.source === "Referral" && !parsed.data.referrerName) return { error: fail("Enter who referred this lead", { referrerName: "Required for Referral" }) };
  const mobiles = readMobiles(form);
  if ("error" in mobiles) return { error: fail(mobiles.error, { mobile: mobiles.error }) };
  return { details: parsed.data, numbers: mobiles.numbers };
}

/** Lead columns from the form; the first mobile is the lead's main number. */
const leadData = (d: Details, numbers: { number: string; isWhatsApp: boolean }[]) => ({
  name: [d.firstName, d.lastName].filter(Boolean).join(" "), firstName: d.firstName, lastName: d.lastName || null,
  dob: new Date(`${d.dob}T00:00:00Z`), gender: d.gender, email: d.email || null, address: d.address || null,
  source: d.source, referrerName: d.source === "Referral" ? d.referrerName : null, interest: d.interest || null, notes: d.notes || null,
  mobile: numbers[0].number, onWhatsApp: numbers[0].isWhatsApp,
});

/** A number may belong to one lead only. Returns the refusal message, or null. */
async function duplicateMobile(user: SessionUser, numbers: string[], exceptLeadId?: string) {
  const taken = await db.leadMobile.findFirst({
    where: { tenantId: user.tenantId, number: { in: numbers }, ...(exceptLeadId && { leadId: { not: exceptLeadId } }) },
    include: { lead: { select: { leadNo: true, name: true, ownerId: true } } },
  });
  if (!taken) return null;
  const owner = await db.user.findUnique({ where: { id: taken.lead.ownerId }, select: { name: true } });
  return `${taken.number} is already lead ${taken.lead.leadNo} (${taken.lead.name}, owner ${owner?.name ?? "—"})`;
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const createSchema = z.object({
  status: z.enum(LeadStatus, "Pick the lead status"),
  reason: z.string().trim().max(200),
  ownerId: z.string(),
  callDate: z.string(),
  callTime: z.string(),
});

export async function createLead(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Create");
  const p = parseDetails(form);
  if (p.error) return p.error;
  const parsed = createSchema.safeParse({ status: form.get("status") || undefined, reason: form.get("reason") ?? "", ownerId: form.get("ownerId") ?? "", callDate: form.get("callDate") ?? "", callTime: form.get("callTime") ?? "" });
  if (!parsed.success) return fail("Check the highlighted fields", fieldErrors(parsed.error));
  const v = parsed.data;

  const ownerId = seesAll(user.role) && v.ownerId ? v.ownerId : user.id;
  let callAt: Date | null = null;
  if (v.status === "NotInterested") {
    if (!v.reason) return fail("Enter why the lead is not interested", { reason: "Required" });
  } else {
    const t = optionalCall(v.callDate, v.callTime);
    if (typeof t === "string") return fail(t, { callDate: t });
    if (v.status === "CallBack" && !t) return fail("Call back needs the call date and time", { callDate: "Required for Call back" });
    callAt = t;
  }
  const dup = await duplicateMobile(user, p.numbers.map((m) => m.number));
  if (dup) return fail(dup, { mobile: dup });

  try {
    const lead = await db.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          tenantId: user.tenantId, leadNo: await nextNumber(tx, user.tenantId, "lead"), ownerId, ...leadData(p.details, p.numbers),
          status: v.status, notInterestedReason: v.status === "NotInterested" ? v.reason : null,
          mobiles: { create: p.numbers.map((m, i) => ({ tenantId: user.tenantId, number: m.number, isWhatsApp: m.isWhatsApp, sort: i })) },
        },
      });
      if (callAt) await tx.call.create({ data: { tenantId: user.tenantId, leadId: lead.id, ownerId, dueAt: callAt, note: p.details.notes || null } });
      return lead;
    });
    revalidatePath("/", "layout");
    return { ok: true, id: lead.id };
  } catch (e) {
    // Another user saved the same mobile a moment ago.
    if (isUnique(e)) return fail("One of these mobile numbers was just added as a lead", { mobile: "Duplicate mobile" });
    throw e;
  }
}

/** What the change log shows for a lead's details. */
const detailsSnapshot = (l: { name: string; dob: Date | null; gender: Gender | null; email: string | null; address: string | null; source: LeadSource; referrerName: string | null; interest: string | null; notes: string | null }, mobiles: { number: string; isWhatsApp: boolean }[]) => ({
  name: l.name, dob: l.dob ? fmtDmy(l.dob) : null, gender: l.gender ? GENDER_LABEL[l.gender] : null, mobiles: mobiles.map((m) => `${m.number}${m.isWhatsApp ? " (WhatsApp)" : ""}`).join(", "),
  email: l.email, address: l.address, businessType: LEAD_SOURCE_LABEL[l.source], referredBy: l.referrerName, interestedProduct: l.interest, notes: l.notes,
});

/** Correct a lead's details (name, DOB, gender, mobiles…). Owner or Admin; the change is logged. */
export async function editLead(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Edit");
  const leadId = String(form.get("leadId") ?? "");
  const lead = await db.lead.findFirst({ where: { id: leadId, tenantId: user.tenantId }, include: { mobiles: { orderBy: { sort: "asc" } } } });
  if (!lead) return fail("Lead not found");
  if (!canActOn(user, lead.ownerId)) return fail("This lead belongs to another user");
  const p = parseDetails(form);
  if (p.error) return p.error;
  const dup = await duplicateMobile(user, p.numbers.map((m) => m.number), lead.id);
  if (dup) return fail(dup, { mobile: dup });

  try {
    await db.$transaction(async (tx) => {
      const data = leadData(p.details, p.numbers);
      const after = await tx.lead.update({ where: { id: lead.id }, data });
      await tx.leadMobile.deleteMany({ where: { leadId: lead.id } });
      await tx.leadMobile.createMany({ data: p.numbers.map((m, i) => ({ tenantId: user.tenantId, leadId: lead.id, number: m.number, isWhatsApp: m.isWhatsApp, sort: i })) });
      const diff = changedOnly(detailsSnapshot(lead, lead.mobiles), detailsSnapshot(after, p.numbers));
      if (Object.keys(diff.after).length) await audit(tx, user, { entity: "Lead", entityId: lead.id, action: "Updated", summary: `Lead ${lead.leadNo} details corrected`, ...diff });
    });
  } catch (e) {
    if (isUnique(e)) return fail("One of these mobile numbers was just added to another lead", { mobile: "Duplicate mobile" });
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, id: lead.id };
}

// ── Status, calls and follow-ups ──

/** Close every open call of a lead (it is not interested). */
const closeLeadCalls = (tx: Tx, leadId: string, note: string) =>
  tx.call.updateMany({ where: { leadId, outcome: null }, data: { outcome: "NotInterested", outcomeNote: note, completedAt: new Date() } });

const updateSchema = z.object({
  leadId: z.string(),
  status: z.enum(LeadStatus),
  note: z.string().trim().max(500),
  callDate: z.string(),
  callTime: z.string(),
});

/** Lead side panel: change status and/or (re)schedule the next call. Call back must have a call booked. */
export async function updateLead(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Edit");
  const parsed = updateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields", fieldErrors(parsed.error));
  const v = parsed.data;

  const lead = await db.lead.findFirst({ where: { id: v.leadId, tenantId: user.tenantId } });
  if (!lead) return fail("Lead not found");
  if (!canActOn(user, lead.ownerId)) return fail("This lead belongs to another user");

  let callAt: Date | null = null;
  if (v.status === "NotInterested") {
    if (!v.note) return fail("Enter the reason", { note: "Reason required" });
  } else {
    const t = optionalCall(v.callDate, v.callTime);
    if (typeof t === "string") return fail(t, { callDate: t });
    callAt = t;
  }
  const open = await db.call.findFirst({ where: { leadId: lead.id, outcome: null }, orderBy: { dueAt: "asc" } });
  if (v.status === "CallBack" && !callAt && !open) return fail("Call back needs the next call date and time", { callDate: "Required for Call back" });

  await db.$transaction(async (tx) => {
    if (v.status === "NotInterested") {
      await tx.lead.update({ where: { id: lead.id }, data: { status: "NotInterested", notInterestedReason: v.note } });
      await closeLeadCalls(tx, lead.id, v.note);
      return;
    }
    if (callAt) {
      if (open) await tx.call.update({ where: { id: open.id }, data: { dueAt: callAt, note: v.note || open.note } });
      else await tx.call.create({ data: { tenantId: user.tenantId, leadId: lead.id, ownerId: lead.ownerId, dueAt: callAt, note: v.note || null } });
    } else if (open && v.note) {
      await tx.call.update({ where: { id: open.id }, data: { note: v.note } });
    }
    await tx.lead.update({ where: { id: lead.id }, data: { status: v.status, notInterestedReason: null } });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

const outcomeSchema = z.object({
  callId: z.string(),
  outcome: z.enum(["Interested", "NoAnswer", "NotInterested", "Done"], "Pick an outcome"),
  note: z.string().trim().max(500),
  reason: z.string().trim().max(200),
  callDate: z.string(),
  callTime: z.string(),
});

/**
 * Close a call with an outcome. Lead calls: Interested (next call optional), No answer / call back (next call
 * required), Not interested (reason; closes the lead). Renewal and proposal calls: No answer (next call) or Done.
 */
export async function saveCallOutcome(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Edit");
  const parsed = outcomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields", fieldErrors(parsed.error));
  const v = parsed.data;

  const call = await db.call.findFirst({ where: { id: v.callId, tenantId: user.tenantId }, include: { lead: true } });
  if (!call) return fail("Call not found");
  if (!canActOn(user, call.ownerId)) return fail("This call belongs to another user");
  const lead = call.lead;
  if (lead && v.outcome === "Done") return fail("Pick Interested, Not interested or No answer for a lead call");
  if (!lead && (v.outcome === "Interested" || v.outcome === "NotInterested")) return fail("Pick Done or No answer for this call");

  let nextAt: Date | null = null;
  if (v.outcome === "NotInterested") {
    if (!v.reason) return fail("Enter a reason", { reason: "Required when not interested" });
  } else if (v.outcome !== "Done") {
    const t = optionalCall(v.callDate, v.callTime);
    if (typeof t === "string") return fail(`New call time: ${t.toLowerCase()}`, { callDate: t });
    if (v.outcome === "NoAnswer" && !t) return fail("No answer needs the next call date and time", { callDate: "Required" });
    nextAt = t;
  }

  return db.$transaction(async (tx) => {
    const closed = await tx.call.updateMany({
      where: { id: call.id, outcome: null },
      data: { outcome: v.outcome, outcomeNote: v.note || v.reason || null, completedAt: new Date() },
    });
    if (closed.count === 0) return fail("This call was already saved");
    if (nextAt) {
      await tx.call.create({
        data: { tenantId: user.tenantId, leadId: call.leadId, policyId: call.policyId, proposalId: call.proposalId, customerId: call.customerId, ownerId: call.ownerId, dueAt: nextAt, note: v.note || call.note },
      });
    }
    if (lead) {
      if (v.outcome === "NotInterested") {
        await tx.lead.update({ where: { id: lead.id }, data: { status: "NotInterested", notInterestedReason: v.reason } });
        await closeLeadCalls(tx, lead.id, "Lead closed");
      } else {
        await tx.lead.update({ where: { id: lead.id }, data: { status: v.outcome === "Interested" ? "Interested" : "CallBack", notInterestedReason: null } });
      }
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

const scheduleSchema = z.object({
  kind: z.enum(["lead", "policy", "proposal", "customer"]),
  refId: z.string().min(1, "Pick who to call"),
  callDate: z.string(),
  callTime: z.string(),
  note: z.string().trim().max(500),
});

/** Book a follow-up call about a lead, a renewal (policy) or a proposal. The call goes to the record's owner. */
export async function scheduleCall(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Edit");
  const parsed = scheduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message, fieldErrors(parsed.error));
  const v = parsed.data;
  const at = futureTime(v.callDate, v.callTime);
  if (typeof at === "string") return fail(at, { callDate: at });

  const where = { id: v.refId, tenantId: user.tenantId };
  const record = v.kind === "lead" ? await db.lead.findFirst({ where })
    : v.kind === "policy" ? await db.policy.findFirst({ where })
    : v.kind === "customer" ? await db.customer.findFirst({ where })
    : await db.proposal.findFirst({ where });
  if (!record) return fail("Not found; reload and try again");
  if (!canActOn(user, record.ownerId)) return fail("This belongs to another user");
  if (v.kind === "lead" && (record as { status: LeadStatus }).status === "NotInterested") return fail("This lead is closed (not interested)");
  if (v.kind === "policy" && (record as { status: string }).status !== "Active") return fail("This policy is no longer active");

  await db.$transaction(async (tx) => {
    await tx.call.create({
      data: {
        tenantId: user.tenantId, ownerId: record.ownerId, dueAt: at, note: v.note || null,
        ...(v.kind === "lead" ? { leadId: record.id } : v.kind === "policy" ? { policyId: record.id } : v.kind === "customer" ? { customerId: record.id } : { proposalId: record.id }),
      },
    });
    if (v.kind === "lead") await tx.lead.update({ where: { id: record.id }, data: { status: "CallBack" } });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
