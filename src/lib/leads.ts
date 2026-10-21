import type { LeadStage, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { seesAll } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

/** Users act on their own leads and calls; Admin and Super Admin on the whole agency. */
export const canActOn = (user: SessionUser, ownerId: string) => seesAll(user.role) || ownerId === user.id;

export const ownerScope = (user: SessionUser) => (seesAll(user.role) ? {} : { ownerId: user.id });

export async function userNames(tenantId: string) {
  const users = await db.user.findMany({ where: { tenantId }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  return users;
}

const STAGE_ORDER: LeadStage[] = ["Lead", "Quotation", "Proposal", "Customer"];

/** Moves a lead's stage forward (never back): quotation made, proposal made, policy issued. */
export function advanceStage(tx: Tx, leadId: string, stage: LeadStage) {
  return tx.lead.updateMany({ where: { id: leadId, stage: { in: STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage)) } }, data: { stage } });
}

/** Who and what a call is about: a lead, a renewal (policy) or a proposal. */
export const callInclude = {
  lead: { select: { id: true, leadNo: true, name: true, mobile: true } },
  policy: { select: { id: true, policyNumber: true, partner: true, productName: true, customer: { select: { id: true, name: true, mobile: true } } } },
  proposal: { select: { id: true, proposalNo: true, customerName: true, mobile: true } },
  customer: { select: { id: true, cifNo: true, name: true, mobile: true } },
} satisfies Prisma.CallInclude;
type CallWithParty = Prisma.CallGetPayload<{ include: typeof callInclude }>;

export type CallKind = "lead" | "renewal" | "proposal" | "customer";

/** Name, mobile, "For" label and link for any call. */
export function callParty(c: CallWithParty) {
  if (c.lead) return { kind: "lead" as CallKind, name: c.lead.name, mobile: c.lead.mobile, forLabel: `Lead ${c.lead.leadNo}`, href: `/leads?id=${c.lead.id}`, leadId: c.lead.id };
  if (c.policy) {
    return { kind: "renewal" as CallKind, name: c.policy.customer.name, mobile: c.policy.customer.mobile, forLabel: `Renewal ${c.policy.policyNumber}`, href: `/customers/${c.policy.customer.id}`, leadId: null };
  }
  if (c.proposal) return { kind: "proposal" as CallKind, name: c.proposal.customerName, mobile: c.proposal.mobile, forLabel: `Proposal ${c.proposal.proposalNo}`, href: `/proposals/${c.proposal.id}`, leadId: null };
  if (c.customer) return { kind: "customer" as CallKind, name: c.customer.name, mobile: c.customer.mobile, forLabel: `Customer ${c.customer.cifNo}`, href: `/customers/${c.customer.id}`, leadId: null };
  return { kind: "lead" as CallKind, name: "—", mobile: "", forLabel: "—", href: "/followups", leadId: null };
}

export type OpenCall = {
  id: string;
  kind: CallKind;
  leadId: string | null;
  forLabel: string;
  href: string;
  name: string;
  mobile: string;
  ownerId: string;
  ownerName: string;
  dueAt: string; // ISO
  note: string | null;
  mine: boolean;
};

/** Open calls (no outcome yet) the user can see, oldest due first. */
export async function openCalls(user: SessionUser): Promise<OpenCall[]> {
  const where: Prisma.CallWhereInput = { tenantId: user.tenantId, outcome: null, ...ownerScope(user) };
  const [calls, users] = await Promise.all([
    db.call.findMany({ where, include: callInclude, orderBy: { dueAt: "asc" } }),
    userNames(user.tenantId),
  ]);
  return calls.map((c) => {
    const p = callParty(c);
    return {
      id: c.id, kind: p.kind, leadId: p.leadId, forLabel: p.forLabel, href: p.href, name: p.name, mobile: p.mobile,
      ownerId: c.ownerId, ownerName: users.find((u) => u.id === c.ownerId)?.name ?? "—",
      dueAt: c.dueAt.toISOString(), note: c.note, mine: c.ownerId === user.id,
    };
  });
}

/** "Interested product" suggestions: active products from Settings → Products and schemes. */
export async function interestOptions(tenantId: string) {
  const products = await db.product.findMany({ where: { tenantId, active: true }, select: { name: true, partner: true }, orderBy: [{ partner: "asc" }, { name: "asc" }] });
  return products.map((p) => (p.name.toLowerCase().includes(p.partner.toLowerCase()) ? p.name : `${p.partner} ${p.name}`));
}
