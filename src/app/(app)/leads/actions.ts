"use server";

import { Prisma, type LeadStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseIstDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { nextNumber } from "@/lib/numbering";
import { seesAll } from "@/lib/permissions";
import { authorize } from "@/lib/session";

export type ActionResult = { ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; id?: string };

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

// Lead statuses a follow-up must not move backwards from.
const LATER_STAGES: LeadStatus[] = ["Quoted", "Converted"];

const leadSchema = z.object({
  name: z.string().trim().min(2, "Enter the name"),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number"),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  source: z.enum(["Website", "WalkIn", "Partner", "Call", "Referral"]),
  interest: z.string().trim().max(200),
  ownerId: z.string(),
  callDate: z.string(),
  callTime: z.string(),
});

export async function createLead(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Create");
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields", fieldErrors(parsed.error));
  const v = parsed.data;

  const ownerId = seesAll(user.role) && v.ownerId ? v.ownerId : user.id;
  let callAt: Date | null = null;
  if (v.callDate || v.callTime) {
    const t = futureTime(v.callDate, v.callTime);
    if (typeof t === "string") return fail(t, { callDate: t });
    callAt = t;
  }

  const existing = await db.lead.findFirst({ where: { tenantId: user.tenantId, mobile: v.mobile } });
  if (existing) {
    const owner = await db.user.findUnique({ where: { id: existing.ownerId }, select: { name: true } });
    const msg = `This mobile is already lead ${existing.leadNo} (${existing.name}, owner ${owner?.name ?? "—"})`;
    return fail(msg, { mobile: msg });
  }

  try {
    const lead = await db.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          tenantId: user.tenantId, leadNo: await nextNumber(tx, user.tenantId, "lead"), name: v.name, mobile: v.mobile,
          email: v.email || null, source: v.source, interest: v.interest || null, ownerId,
          status: callAt ? "CallScheduled" : "New",
        },
      });
      if (callAt) await tx.call.create({ data: { tenantId: user.tenantId, leadId: lead.id, ownerId, dueAt: callAt, note: v.interest || null } });
      return lead;
    });
    revalidatePath("/", "layout");
    return { ok: true, id: lead.id };
  } catch (e) {
    // Another user saved the same mobile a moment ago.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("This mobile was just added as a lead", { mobile: "Duplicate mobile" });
    throw e;
  }
}

const outcomeSchema = z.object({
  callId: z.string(),
  outcome: z.enum(["Interested", "NoAnswer", "NotInterested"], "Pick an outcome"),
  note: z.string().trim().max(500),
  reason: z.string().trim().max(200),
  callDate: z.string(),
  callTime: z.string(),
});

/** Close a call with an outcome. Interested / No answer book the next call; Not interested closes the lead. */
export async function saveCallOutcome(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Edit");
  const parsed = outcomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields", fieldErrors(parsed.error));
  const v = parsed.data;

  let nextAt: Date | null = null;
  if (v.outcome === "NotInterested") {
    if (!v.reason) return fail("Enter a reason", { reason: "Required when not interested" });
  } else {
    const t = futureTime(v.callDate, v.callTime);
    if (typeof t === "string") return fail(`New call time: ${t.toLowerCase()}`, { callDate: t });
    nextAt = t;
  }

  return db.$transaction(async (tx) => {
    const call = await tx.call.findFirst({ where: { id: v.callId, tenantId: user.tenantId }, include: { lead: true } });
    if (!call) return fail("Call not found");
    if (!canActOn(user, call.ownerId)) return fail("This call belongs to another user");
    const closed = await tx.call.updateMany({
      where: { id: call.id, outcome: null },
      data: { outcome: v.outcome, outcomeNote: v.note || v.reason || null, completedAt: new Date() },
    });
    if (closed.count === 0) return fail("This call was already saved");

    const lead = call.lead;
    if (v.outcome === "NotInterested") {
      await tx.lead.update({ where: { id: lead.id }, data: { status: "NotInterested", notInterestedReason: v.reason } });
      await tx.call.updateMany({
        where: { leadId: lead.id, outcome: null },
        data: { outcome: "NotInterested", outcomeNote: "Lead closed", completedAt: new Date() },
      });
    } else {
      await tx.call.create({ data: { tenantId: user.tenantId, leadId: lead.id, ownerId: call.ownerId, dueAt: nextAt!, note: v.note || call.note } });
      if (!LATER_STAGES.includes(lead.status)) {
        const status: LeadStatus = v.outcome === "Interested" ? "Interested" : lead.status === "New" ? "CallScheduled" : lead.status;
        await tx.lead.update({ where: { id: lead.id }, data: { status } });
      }
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

const updateSchema = z.object({
  leadId: z.string(),
  status: z.enum(["New", "CallScheduled", "Interested", "NotInterested", "Quoted", "Converted"]),
  note: z.string().trim().max(500),
  callDate: z.string(),
  callTime: z.string(),
});

/** Lead side panel: change status and/or (re)schedule the next call. */
export async function updateLead(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.Edit");
  const parsed = updateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields", fieldErrors(parsed.error));
  const v = parsed.data;

  const lead = await db.lead.findFirst({ where: { id: v.leadId, tenantId: user.tenantId } });
  if (!lead) return fail("Lead not found");
  if (!canActOn(user, lead.ownerId)) return fail("This lead belongs to another user");
  if (v.status !== lead.status && (LATER_STAGES.includes(v.status) || LATER_STAGES.includes(lead.status))) {
    return fail("Quoted and Converted are set by the quotation and proposal screens");
  }

  let callAt: Date | null = null;
  if (v.status === "NotInterested") {
    if (!v.note) return fail("Enter the reason in the call note", { note: "Reason required" });
  } else if (v.callDate || v.callTime) {
    const t = futureTime(v.callDate, v.callTime);
    if (typeof t === "string") return fail(t, { callDate: t });
    callAt = t;
  }

  await db.$transaction(async (tx) => {
    if (v.status === "NotInterested") {
      await tx.lead.update({ where: { id: lead.id }, data: { status: "NotInterested", notInterestedReason: v.note } });
      await tx.call.updateMany({
        where: { leadId: lead.id, outcome: null },
        data: { outcome: "NotInterested", outcomeNote: v.note, completedAt: new Date() },
      });
      return;
    }
    let status = v.status;
    const open = await tx.call.findFirst({ where: { leadId: lead.id, outcome: null }, orderBy: { dueAt: "asc" } });
    if (callAt) {
      if (open) await tx.call.update({ where: { id: open.id }, data: { dueAt: callAt, note: v.note || open.note } });
      else await tx.call.create({ data: { tenantId: user.tenantId, leadId: lead.id, ownerId: lead.ownerId, dueAt: callAt, note: v.note || null } });
      if (status === "New") status = "CallScheduled";
    } else if (open && v.note) {
      await tx.call.update({ where: { id: open.id }, data: { note: v.note } });
    }
    await tx.lead.update({ where: { id: lead.id }, data: { status, notInterestedReason: null } });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
