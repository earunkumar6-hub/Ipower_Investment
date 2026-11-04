import Link from "next/link";
import { ATTACHMENT_LIST, dropdownValues } from "@/lib/dropdowns";
import { notFound } from "next/navigation";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { attachmentRows, KYC_KINDS } from "@/lib/attachments";
import { addMonths, fmtDate, fmtDateTime, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { fmtTenure, isHealthCover, isPostal, MF_PAY_MODES, PAY_MODES, payModeLabel, sipDateLabel } from "@/lib/products";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { proposalStatusLabel } from "../labels";
import { maskMobile } from "@/lib/lead-labels";
import { JointAccountPanel } from "./joint-account";
import { KycForm, ProposalForm } from "./proposal-forms";

const yearsText = (months: number | null) => (months ? String(months / 12) : "");

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Proposal.View");
  const { id } = await params;
  const p = await db.proposal.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      quotation: true, quotationItem: { select: { category: true } }, policy: { include: { renewals: { orderBy: { dueDate: "asc" } } } },
      product: { include: { schemes: { where: { active: true }, orderBy: [{ tenureMonths: "asc" }, { name: "asc" }] } } }, scheme: true, customer: { select: { id: true, name: true, cifNo: true } },
      secondHolder: { select: { id: true, name: true, cifNo: true, mobile: true, address: true, panMasked: true, aadhaarLast4: true } },
    },
  });
  if (!p || !canActOn(user, p.ownerId)) notFound();
  const files = await attachmentRows(user, "Proposal", p.id);
  const kycDone = KYC_KINDS.filter((k) => files.some((f) => f.kind === k)).length;
  const direct = !p.quotationId;
  const issued = p.status === "Issued";
  const detailsSaved = !!p.frequency && !!p.startDate;
  const [statusLabel, statusTone] = proposalStatusLabel(p);
  const mf = p.productType === "MutualFund";
  const postal = isPostal({ productType: p.productType, partner: p.insurer });
  const holderKind = postal ? "postal" : mf ? "mf" : "other";
  const insurance = p.productType === "Insurance" ? { health: isHealthCover({ invoiceRule: p.product?.invoiceRule, category: p.quotationItem?.category }) } : null;
  const payModes = (p.product?.payModes.length ? p.product.payModes : mf ? MF_PAY_MODES : PAY_MODES).map((m) => ({ value: m, label: payModeLabel(m, mf) }));
  const showPpt = !p.product || p.product.fields.includes("premiumPayingTerm");
  // First holder: the proposal's customer, else the customer the policy will be linked to by mobile on issue.
  const firstCustomer = p.customer ?? (await db.customer.findFirst({
    where: { tenantId: user.tenantId, OR: [{ mobile: p.mobile }, { mobiles: { some: { number: p.mobile } } }] }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, cifNo: true },
  }));
  const holders = (
    <JointAccountPanel issued={issued} joint={p.jointAccount}
      first={{ name: p.customerName, cifNo: firstCustomer?.cifNo ?? null, note: !p.customer && firstCustomer ? `Same mobile as existing customer ${firstCustomer.name}: linked on issue` : null }}
      second={p.secondHolder && { id: p.secondHolder.id, name: p.secondHolder.name, cifNo: p.secondHolder.cifNo, mobile: maskMobile(p.secondHolder.mobile), address: p.secondHolder.address, pan: p.secondHolder.panMasked, aadhaarLast4: p.secondHolder.aadhaarLast4 }}
      newSecond={!p.secondHolder && p.secondHolderName && p.secondHolderMobile ? { name: p.secondHolderName, mobile: p.secondHolderMobile } : null}
      cifs={{ first: p.firstHolderCif, second: p.secondHolderCif }} kind={holderKind} folio={p.folioNo} />
  );
  const consentBy = p.consentById ? (await db.user.findUnique({ where: { id: p.consentById }, select: { name: true } }))?.name : null;
  const secondLabel = p.secondHolder ? `${p.secondHolder.name} (${p.secondHolder.cifNo})` : p.secondHolderName ? `${p.secondHolderName} (new customer on issue)` : "—";

  return (
    <>
      <PageHeader title="Proposals" user={user} />
      {issued && p.policy && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Policy <b>{p.policy.policyNumber}</b> issued and moved to <Link href={`/customers/${p.policy.customerId}`} className="underline">Partners / Customers</Link> under {p.customerName}.
          {p.policy.renewals[0] && <> Next renewal due {fmtDate(p.policy.renewals[0].dueDate)} ({fmtINR(p.policy.renewals[0].premiumAmount)}).</>}
        </div>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-4 rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              Proposal {p.proposalNo} · {p.customerName} ·{" "}
              {p.quotation ? <>from <Link href={`/quotations/${p.quotationId}`} className="text-brand-700 hover:underline">{p.quotation.quoteNo}</Link></>
                : <>added directly{p.customer && <> on <Link href={`/customers/${p.customer.id}`} className="text-brand-700 hover:underline">the customer</Link></>}</>}
            </h2>
            <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Partner</dt><dd>{p.insurer}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Plan</dt><dd>{p.productName}{p.scheme && ` · ${p.scheme.name}`}{p.sumInsured && ` · ${fmtINR(p.sumInsured)}`}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Premium</dt><dd>{fmtINR(p.premium)}</dd></div>
          </dl>

          {issued ? (
            <>
              <div className="rounded-lg border p-3">
                <h3 className="mb-2 text-sm font-medium">Policy details</h3>
                <p className="text-sm">
                  {p.frequency && payModeLabel(p.frequency, mf)}{p.sipDay && ` on the ${sipDateLabel(p.sipDay)}`} · term {fmtTenure(p.termMonths)} · from {p.startDate && fmtDate(p.startDate)}
                  {p.premiumPayingTermMonths && ` · premium paying term ${fmtTenure(p.premiumPayingTermMonths)}`}
                  {p.startDate && p.termMonths && ` · matures ${fmtDate(addMonths(p.startDate, p.termMonths))}`}
                </p>
              </div>
              {holders}
            </>
          ) : (
            // One form, Save proposal last: details → account holders → policy number (owner, 3 Nov 2026).
            <ProposalForm proposalId={p.id} payModes={payModes} schemes={p.product?.schemes.map((s) => ({ id: s.id, name: s.name, tenureMonths: s.tenureMonths })) ?? []} showPpt={showPpt}
              initial={{ frequency: p.frequency ?? "", term: yearsText(p.termMonths), ppt: yearsText(p.premiumPayingTermMonths), startDate: p.startDate ? isoDate(p.startDate) : "", schemeId: p.schemeId ?? "", sipDay: p.sipDay ? String(p.sipDay) : "", premium: p.premium.toString(), sumInsured: p.sumInsured?.toString() ?? "" }} mf={mf} insurance={insurance}>
              {holders}
            </ProposalForm>
          )}

          <Table>
            <TableHeader><TableRow><TableHead>Step</TableHead><TableHead>Status</TableHead><TableHead>When / detail</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{direct ? "Added directly on the customer" : "Proposal made from the quotation"}</TableCell>
                <TableCell><StatusBadge tone="green">Done</StatusBadge></TableCell>
                <TableCell>{fmtDateTime(p.createdAt)}</TableCell>
              </TableRow>
              {mf && (
                <TableRow>
                  <TableCell>Folio number</TableCell>
                  <TableCell>{p.folioNo ? <StatusBadge tone="green">Entered</StatusBadge> : <StatusBadge tone="slate">Not entered</StatusBadge>}</TableCell>
                  <TableCell>{p.folioNo ?? "—"}</TableCell>
                </TableRow>
              )}
              {postal && !p.jointAccount && (
                <TableRow>
                  <TableCell>Holder CIF (post office)</TableCell>
                  <TableCell>{p.firstHolderCif ? <StatusBadge tone="green">Entered</StatusBadge> : <StatusBadge tone="slate">Not entered</StatusBadge>}</TableCell>
                  <TableCell>{p.firstHolderCif ?? "—"}</TableCell>
                </TableRow>
              )}
              {p.jointAccount && (
                <TableRow>
                  <TableCell>Joint account</TableCell>
                  <TableCell><StatusBadge tone={p.secondHolderId || p.secondHolderName ? "green" : "orange"}>{p.secondHolderId || p.secondHolderName ? "Two holders" : "Second holder missing"}</StatusBadge></TableCell>
                  <TableCell>
                    {p.customerName}{firstCustomer && ` (${firstCustomer.cifNo})`} + {secondLabel}
                    {postal && <span className="block text-xs text-muted-foreground">Post office CIF: {p.firstHolderCif ?? "—"} / {p.secondHolderCif ?? "—"}</span>}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>Customer consent taken</TableCell>
                <TableCell>{p.consentAt ? <StatusBadge tone="green">Ticked</StatusBadge> : <StatusBadge tone="slate">Not ticked</StatusBadge>}</TableCell>
                <TableCell>{p.consentAt ? `By ${consentBy ?? "—"}, ${fmtDate(p.consentAt)}` : "Needed before Aadhaar / PAN can be saved"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Aadhaar and PAN <span className="text-xs text-muted-foreground">(optional)</span></TableCell>
                <TableCell>{p.panMasked || p.aadhaarLast4 ? <StatusBadge tone="green">Entered – masked</StatusBadge> : <StatusBadge tone="slate">Not entered</StatusBadge>}</TableCell>
                <TableCell>{[p.aadhaarLast4 && `XXXX-XXXX-${p.aadhaarLast4}`, p.panMasked].filter(Boolean).join(" · ")}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>KYC documents <span className="text-xs text-muted-foreground">(optional)</span></TableCell>
                <TableCell><StatusBadge tone={kycDone > 0 ? "green" : "slate"}>{kycDone} uploaded</StatusBadge></TableCell>
                <TableCell>Not required to save or submit{kycDone < KYC_KINDS.length && <span className="block text-xs text-muted-foreground">{KYC_KINDS.filter((k) => !files.some((f) => f.kind === k)).join(", ")} not uploaded</span>}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Policy details (pay mode, term, start)</TableCell>
                <TableCell>{detailsSaved ? <StatusBadge tone="green">Saved</StatusBadge> : <StatusBadge tone="orange">Not yet</StatusBadge>}</TableCell>
                <TableCell>{detailsSaved && `${payModeLabel(p.frequency!, mf)} from ${fmtDate(p.startDate!)}${p.sipDay ? ` · SIP date ${sipDateLabel(p.sipDay)}` : ""}`}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Policy issued by partner</TableCell>
                <TableCell>{issued ? <StatusBadge tone="green">Issued</StatusBadge> : <StatusBadge tone="slate">Not yet</StatusBadge>}</TableCell>
                <TableCell>{p.policyNumber ?? "—"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {issued && p.policy && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Renewal schedule</h3>
              <ul className="text-sm">
                {p.policy.renewals.map((r) => <li key={r.id}>{fmtDate(r.dueDate)} · {fmtINR(r.premiumAmount)} · {r.status}</li>)}
                {p.policy.renewals.length === 0 && <li className="text-muted-foreground">No renewals (one-time or no bills).</li>}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-1 text-sm font-medium">Documents</h3>
            <AttachmentsPanel ownerType="Proposal" ownerId={p.id} kinds={await dropdownValues(db, user.tenantId, ATTACHMENT_LIST.Proposal)} files={files} />
          </div>
        </div>
        <aside className="w-80 shrink-0 rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">Aadhaar and PAN <span className="text-xs font-normal text-muted-foreground">(optional)</span></h2>
          <KycForm key={`${issued}-${p.panMasked}-${p.aadhaarLast4}-${!!p.consentAt}`} allowed={hasPermission(user.role, "PII.Edit")} unlocked={!issued} panMasked={p.panMasked} aadhaarLast4={p.aadhaarLast4}
            consent={p.consentAt ? `By ${consentBy ?? "—"}, ${fmtDate(p.consentAt)}` : null} />
        </aside>
      </div>
    </>
  );
}
