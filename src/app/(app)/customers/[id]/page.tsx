import Link from "next/link";
import { closureButton } from "@/lib/closure";
import { initials } from "@/lib/photos";
import { AddFollowUpForm, CustomerPhoto, IdentityButton } from "./profile-forms";
import { db } from "@/lib/db";
import { ATTACHMENT_LIST, dropdownValues } from "@/lib/dropdowns";
import { notFound } from "next/navigation";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { attachmentRows } from "@/lib/attachments";
import { HOLDING_KIND as KIND, loadCustomer360, PER_LABEL } from "@/lib/customer-360";
import { fmtDate, fmtDateTime, isoDate, istDate, istToday } from "@/lib/dates";
import { maskMobile } from "@/lib/lead-labels";
import { daysBetween, overdueText } from "@/lib/overdue";
import { MODE_LABEL } from "@/lib/payment-modes";
import { fmtINR } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { fmtTenure } from "@/lib/products";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { EditCustomerButton, HoldingsTable } from "./customer-forms";

const RENEWAL_TONE: Record<string, Tone> = { Due: "orange", Overdue: "red", Paid: "green", Lapsed: "slate", Stopped: "slate" };
const POLICY_STATUS: Record<string, [string, Tone]> = {
  Active: ["Active", "green"], Lapsed: ["Lapsed", "red"], Matured: ["Matured", "slate"], PrematureClosed: ["Premature closed", "slate"], Withdrawn: ["Withdrawn", "slate"],
};
const SLIP: Record<string, [string, Tone]> = {
  CustomerOwes: ["Owner paid – customer owes", "indigo"], CollectedReturnToOwner: ["Collected – return to owner", "orange"], Settled: ["Settled", "green"], Cancelled: ["Cancelled", "slate"],
};
const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** Customer 360: every holding, renewal, receipt, owner-paid slip and linked entry for one person. */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Policy.View");
  const data = await loadCustomer360(user, (await params).id);
  if (!data) notFound();
  const { c, owner, renewals, receiptNo, holdings, cards, services, directBills, followUps, nextFollowUp, activity, oneTimeTotal, regular, slipFor } = data;
  const today = istToday();
  const canEdit = hasPermission(user.role, "Policy.Create");
  const files = await attachmentRows(user, "Customer", c.id);
  const mobiles = c.mobiles.length ? c.mobiles : [{ number: c.mobile, isWhatsApp: false }];

  return (
    <>
      <PageHeader title="Partners / Customers" user={user} actions={
        <>
          <ExportButton report="customer" user={user} params={{ id: c.id }} />
          <Link href={`/quotations/new?customerId=${c.id}`} className={buttonVariants({ variant: "outline" })}>New quotation</Link>
          {canEdit && <Link href={`/customers/${c.id}/add-product`} className={buttonVariants({ variant: "outline" })}>Add product directly</Link>}
          <Link href={`/receipts/new?customerId=${c.id}`} className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>Generate receipt</Link>
        </>
      } />
      <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border bg-white p-4">
        <CustomerPhoto customerId={c.id} name={c.name} initials={initials(c.name)} hasPhoto={!!c.photoPath} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{c.name}</h2>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{c.cifNo}</span>
            {c.consentAt && <StatusBadge tone="green">Consent taken {fmtDate(c.consentAt)}</StatusBadge>}
            {nextFollowUp && <StatusBadge tone={nextFollowUp.dueAt <= new Date() ? "red" : "orange"}>Follow-up due {fmtDateTime(nextFollowUp.dueAt)}</StatusBadge>}
            {canEdit && <EditCustomerButton customer={{ id: c.id, name: c.name, email: c.email ?? "", address: c.address ?? "", mobiles: mobiles.map((m) => ({ number: m.number, isWhatsApp: m.isWhatsApp })) }} />}
          </div>
          <p className="text-sm text-muted-foreground">
            {mobiles.map((m) => `${m.number}${m.isWhatsApp ? " (WhatsApp)" : ""}`).join(" · ")}{c.email && ` · ${c.email}`}{c.address && ` · ${c.address}`} · Owner: {owner?.name}
          </p>
          <p className="mt-1 text-sm">
            PAN {c.panMasked ?? <span className="text-muted-foreground">not collected</span>} · Aadhaar {c.aadhaarLast4 ? `XXXX-XXXX-${c.aadhaarLast4}` : <span className="text-muted-foreground">not collected</span>}
            {" "}<IdentityButton customerId={c.id} panMasked={c.panMasked} aadhaarLast4={c.aadhaarLast4}
              consent={c.consentAt ? `By ${(await db.user.findUnique({ where: { id: c.consentById ?? "" }, select: { name: true } }))?.name ?? "—"}, ${fmtDate(c.consentAt)}` : null} />
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-4 gap-3">
          <StatCard title="Holdings" value={String(cards.holdings)} sub={`${cards.sources} source${cards.sources === 1 ? "" : "s"}`} />
          <StatCard title="Total yearly premium" value={fmtINR(cards.yearlyPremium)} sub="Insurance" />
          <StatCard title="Investments" value={fmtINR(cards.investments)} sub="Post office + MF" />
          <StatCard title="Next renewal" value={cards.nextDue ? fmtDate(cards.nextDue.dueDate) : "—"}
            sub={cards.nextDue ? `${cards.nextDue.policy.partner} ${fmtINR(cards.nextDue.premiumAmount)}` : undefined} alert={cards.nextDue?.status === "Overdue"} />
        </div>
      </div>

      <Section title="Products invested">
        <HoldingsTable rows={holdings.map((p) => ({
          id: p.id,
          customerId: c.id,
          kind: KIND[p.productType],
          plan: p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} · ${p.productName}${p.schemeName ? ` · ${p.schemeName}` : ""}` : p.schemeName ?? p.productName,
          cover: p.sumAssured ? fmtINR(p.sumAssured) : null,
          policyNumber: p.policyNumber,
          amount: fmtINR(p.premiumAmount),
          per: PER_LABEL[p.frequency],
          rate: p.rateAtOpen ? `${p.rateAtOpen.toFixed(2)}%` : "—",
          commenced: fmtDate(p.startDate),
          tenure: p.termMonths ? fmtTenure(p.termMonths) : p.productType === "MutualFund" ? "Open-ended" : "—",
          lockIn: p.lockIn && p.lockIn > p.startDate ? fmtDate(p.lockIn) : "—",
          maturity: p.maturity ? fmtDate(p.maturity) : "—",
          status: POLICY_STATUS[p.status],
          closedNote: p.closedOn ? fmtDate(p.closedOn) : null,
          details: p.details,
          close: canEdit && p.status === "Active" ? (() => {
            const b = closureButton(p, p.lockIn && p.lockIn > p.startDate ? p.lockIn : null, today, fmtDate);
            if (b.state !== "active") return { state: b.state, text: b.text };
            return {
              state: b.state, label: `${p.partner} ${p.productName} · ${p.policyNumber}`, isMf: b.withdraw, today: isoDate(today), startDate: isoDate(p.startDate),
              lockInUntil: b.lockInUntil ? isoDate(b.lockInUntil) : null,
            };
          })() : null,
        }))} />
        <p className="mt-2 text-sm">
          Total invested in one-time schemes: <b>{fmtINR(oneTimeTotal)}</b>
          {regular.length > 0 && <> · Regular premiums: {regular.map((r) => `${fmtINR(r.amount)} ${PER_LABEL[r.frequency]}`).join(" · ")}</>}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Schemes, tenures, lock-in periods and rates come from Settings → Products and schemes; each account keeps the rate it was opened at. Click a policy number for its full renewal schedule.</p>
        {c.jointPolicies.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-sm font-medium">Joint accounts – second holder</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Policy / account</TableHead><TableHead>Plan</TableHead><TableHead>First holder</TableHead><TableHead>Company CIF (first / second)</TableHead><TableHead className="text-right">Premium</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.jointPolicies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.policyNumber}</TableCell>
                    <TableCell>{p.partner} · {p.productName}</TableCell>
                    <TableCell><Link href={`/customers/${p.customer.id}`} className="text-brand-700 hover:underline">{p.customer.name}</Link> <span className="text-xs text-muted-foreground">{p.customer.cifNo}</span></TableCell>
                    <TableCell>{p.firstHolderCif ?? "—"} / {p.secondHolderCif ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtINR(p.premiumAmount)} {PER_LABEL[p.frequency]}</TableCell>
                    <TableCell>{POLICY_STATUS[p.status]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-1 text-xs text-muted-foreground">Bills, receipts and renewals for these are on the first holder&apos;s page.</p>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-4">
          <Section title="Renewals – all policies">
            <Table>
              <TableHeader><TableRow><TableHead>Due</TableHead><TableHead>Policy / account</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Paid · receipt</TableHead></TableRow></TableHeader>
              <TableBody>
                {renewals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.policy.productType === "PoRd" ? monthLabel(r.dueDate) : fmtDate(r.dueDate)}</TableCell>
                    <TableCell>{r.policy.policyNumber}</TableCell>
                    <TableCell className="text-right">{fmtINR(r.premiumAmount)}</TableCell>
                    <TableCell><StatusBadge tone={RENEWAL_TONE[r.status]}>{r.status === "Overdue" ? `Overdue · ${overdueText(daysBetween(r.dueDate, istToday()))}` : r.status}</StatusBadge></TableCell>
                    <TableCell className="text-sm">
                      {r.paidOn ? fmtDate(r.paidOn) : "—"}
                      {r.paidReceiptId && <> · <Link href={receiptNo.get(r.paidReceiptId)?.href ?? `/receipts/${r.paidReceiptId}`} className="text-brand-700 hover:underline">{receiptNo.get(r.paidReceiptId)?.no}</Link></>}
                      {r.status === "Paid" && !r.paidReceiptId && <span className="text-muted-foreground"> · {slipFor.has(r.id) ? `owner paid · ${slipFor.get(r.id)}` : "before this system"}</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {renewals.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No renewals.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Section>
          <Section title="Linked by mobile number">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Reference</TableHead><TableHead>Mobile</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {services.map((t) => (
                  <TableRow key={t.id} className={cn(t.status !== "Saved" && "text-muted-foreground")}>
                    <TableCell>{fmtDate(t.txnDate)}</TableCell>
                    <TableCell>E-Sevai – {t.serviceType.name}{t.status !== "Saved" && " (cancelled)"}</TableCell>
                    <TableCell>{t.providerRef ?? t.txnNo}</TableCell>
                    <TableCell>{t.customerMobile && maskMobile(t.customerMobile)}</TableCell>
                    <TableCell className="text-right">{fmtINR(t.customerAmount)}</TableCell>
                  </TableRow>
                ))}
                {directBills.map((b) => (
                  <TableRow key={b.id} className={cn(b.status !== "Saved" && "text-muted-foreground")}>
                    <TableCell>{fmtDate(b.billDate)}</TableCell>
                    <TableCell>Direct bill – {b.purpose}{b.status !== "Saved" && " (cancelled)"}</TableCell>
                    <TableCell><Link href={`/direct-bills/${b.id}`} className="text-brand-700 hover:underline">{b.billNo}</Link></TableCell>
                    <TableCell>{maskMobile(b.payerMobile)}</TableCell>
                    <TableCell className="text-right">{fmtINR(b.amount)}</TableCell>
                  </TableRow>
                ))}
                {services.length + directBills.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No E-Sevai entries or direct bills with this customer&apos;s numbers.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Section>
          <Section title="Follow-ups">
            <Table>
              <TableHeader><TableRow><TableHead>Date / time</TableHead><TableHead>Type</TableHead><TableHead>Owner</TableHead><TableHead>Notes</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {followUps.map((f) => (
                  <TableRow key={f.id} className={cn(!f.open && "text-muted-foreground")}>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(f.dueAt)}</TableCell>
                    <TableCell>{f.type}<span className="block text-xs text-muted-foreground">{f.forLabel}</span></TableCell>
                    <TableCell>{f.owner}</TableCell>
                    <TableCell className="text-sm whitespace-normal">{f.note ?? "—"}{f.outcomeNote && <span className="block text-xs text-muted-foreground">{f.outcomeNote}</span>}</TableCell>
                    <TableCell><StatusBadge tone={f.status === "Overdue" ? "red" : f.open ? "orange" : "slate"}>{f.status}</StatusBadge></TableCell>
                  </TableRow>
                ))}
                {followUps.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No follow-ups yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
            <AddFollowUpForm customerId={c.id} today={isoDate(today)} />
          </Section>
          <Section title="Recent activity">
            <ul className="space-y-1.5 text-sm">
              {activity.map((a, i) => <li key={i} className="flex gap-3"><span className="w-28 shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.at)}</span><span>{a.text}</span></li>)}
              {activity.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
            </ul>
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Receipts for this customer">
            <Table>
              <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead>For</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.receipts.map((r) => (
                  <TableRow key={r.id} className={cn(r.status === "Cancelled" && "text-muted-foreground")}>
                    <TableCell><Link href={`/receipts/${r.id}`} className="text-brand-700 hover:underline">{r.receiptNo}</Link></TableCell>
                    <TableCell>{fmtDate(r.receiptDate)}</TableCell>
                    <TableCell>{r.policy?.policyNumber ?? r.notes}{r.ownerPaid && " (owner-paid)"}</TableCell>
                    <TableCell className="text-right">{fmtINR(r.amount)} · {MODE_LABEL[r.mode]}</TableCell>
                    <TableCell><StatusBadge tone={r.status === "Cancelled" ? "slate" : "green"}>{r.status}</StatusBadge></TableCell>
                  </TableRow>
                ))}
                {c.ownerPaidSlips.filter((s) => s.closedByReceipt).map((s) => (
                  <TableRow key={s.id} className="text-muted-foreground">
                    <TableCell>{s.slipNo}</TableCell>
                    <TableCell>{fmtDate(istDate(s.createdAt))}</TableCell>
                    <TableCell>{s.policy.policyNumber} – paid by owner · {s.poReceiptNo}</TableCell>
                    <TableCell className="text-right">{fmtINR(s.amount)}</TableCell>
                    <TableCell className="text-xs">Closed by {s.closedByReceipt!.receiptNo}</TableCell>
                  </TableRow>
                ))}
                {c.receipts.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No receipts yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Section>
          <Section title="Documents">
            <AttachmentsPanel ownerType="Customer" ownerId={c.id} kinds={await dropdownValues(db, user.tenantId, ATTACHMENT_LIST.Customer)} files={files} />
          </Section>
          <Section title="Owner-paid renewals for this customer">
            <Table>
              <TableHeader><TableRow><TableHead>Slip</TableHead><TableHead>Account</TableHead><TableHead>Month</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reference</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.ownerPaidSlips.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.slipNo}</TableCell><TableCell>{s.policy.policyNumber}</TableCell><TableCell>{monthLabel(s.month)}</TableCell>
                    <TableCell className="text-right">{fmtINR(s.amount)}</TableCell>
                    <TableCell>{s.poReceiptNo}</TableCell>
                    <TableCell><StatusBadge tone={SLIP[s.status][1]}>{SLIP[s.status][0]}</StatusBadge>{s.closedByReceipt && <span className="ml-1 text-xs text-muted-foreground">{s.closedByReceipt.receiptNo}</span>}</TableCell>
                  </TableRow>
                ))}
                {c.ownerPaidSlips.length === 0 && <TableRow><TableCell colSpan={6} className="py-4 text-center text-muted-foreground">None.</TableCell></TableRow>}
              </TableBody>
            </Table>
            {c.ownerPaidSlips.some((s) => s.status === "CustomerOwes") && (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>When this customer pays, a pop-up offers to adjust the payment against these slips; only then is the customer receipt created.</span>
                <Link href={`/receipts/new?customerId=${c.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Record customer payment</Link>
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border bg-white p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </div>
  );
}
