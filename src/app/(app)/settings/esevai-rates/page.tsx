import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { isSlabService } from "@/lib/esevai";
import { D, fmtINR } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { SettingsTabs } from "../settings-tabs";
import { DeleteRateButton, RateForm } from "./rate-forms";

const ORDER = ["EB", "PAN", "CERT"];
const rank = (code: string) => (ORDER.includes(code) ? ORDER.indexOf(code) : ORDER.length);

/**
 * Settings → ESEVAI & CSC rates (owner change list, #46): per service, what is paid / deducted, the service charge and
 * what is collected from the customer, each with a start date. The entry form fills these in and staff may change
 * them; Service charge = Collected − Paid. Other services have no rate (amounts are typed on each entry).
 */
export default async function EsevaiRatesPage() {
  const user = await requirePermission("Settings.Edit");
  const today = istToday();
  const types = (await db.serviceType.findMany({ where: { tenantId: user.tenantId, code: { not: "OTHER" } }, include: { rates: { orderBy: [{ minAmount: "asc" }, { effectiveFrom: "desc" }] } } }))
    .sort((a, b) => rank(a.code) - rank(b.code));

  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="esevai-rates" />
      <div className="space-y-4">
        {types.map((t) => {
          const slab = isSlabService(t.code);
          // For each slab (or the one fixed rate): the newest rate that has started is the one in force.
          const inForce = new Set<string>();
          const seen = new Set<string>();
          for (const r of [...t.rates].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())) {
            const k = `${r.minAmount ?? ""}-${r.maxAmount ?? ""}`;
            if (r.effectiveFrom <= today && !seen.has(k)) {
              seen.add(k);
              inForce.add(r.id);
            }
          }
          return (
            <section key={t.id} className="space-y-3 rounded-xl border bg-white p-4">
              <h2 className="font-semibold">{t.name}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    {slab
                      ? <><TableHead>Bill amount</TableHead><TableHead>Amount paid / deducted</TableHead><TableHead className="text-right">Service charge</TableHead><TableHead>Collected from customer</TableHead></>
                      : <><TableHead className="text-right">Amount paid / deducted</TableHead><TableHead className="text-right">Service charge</TableHead><TableHead className="text-right">Collected from customer</TableHead></>}
                    <TableHead>Starts on</TableHead><TableHead>Status</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.rates.map((r) => {
                    const future = r.effectiveFrom > today;
                    const live = inForce.has(r.id);
                    return (
                      <TableRow key={r.id} className={live || future ? "" : "text-muted-foreground"}>
                        {slab ? (
                          <>
                            <TableCell>{fmtINR(r.minAmount ?? 0)} – {fmtINR(r.maxAmount ?? 0)}</TableCell>
                            <TableCell>The bill amount (typed each time)</TableCell>
                            <TableCell className="text-right">{fmtINR(r.serviceCharge ?? 0)}</TableCell>
                            <TableCell>Bill + {fmtINR(r.serviceCharge ?? 0)}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right">{fmtINR(r.walletCost ?? 0)}</TableCell>
                            <TableCell className="text-right">{fmtINR(new D(r.fixedCustomerAmount ?? 0).minus(r.walletCost ?? 0))}</TableCell>
                            <TableCell className="text-right">{fmtINR(r.fixedCustomerAmount ?? 0)}</TableCell>
                          </>
                        )}
                        <TableCell>{fmtDate(r.effectiveFrom)}</TableCell>
                        <TableCell><StatusBadge tone={live ? "green" : future ? "orange" : "slate"}>{live ? "In force" : future ? "Not started" : "Replaced"}</StatusBadge></TableCell>
                        <TableCell className="text-right">{future && <DeleteRateButton id={r.id} />}</TableCell>
                      </TableRow>
                    );
                  })}
                  {t.rates.length === 0 && <TableRow><TableCell colSpan={7} className="py-4 text-center text-muted-foreground">No rate yet – staff type the amounts on each entry.</TableCell></TableRow>}
                </TableBody>
              </Table>
              <RateForm serviceTypeId={t.id} slab={slab} today={isoDate(today)} />
              <p className="text-xs text-muted-foreground">
                {slab
                  ? "A bill amount outside every slab has no rate: staff type what was collected. To change a slab's charge, save the same From / To with a new start date."
                  : "To change the rate, save a new one with its start date. Entries made before that day keep the old rate."}
              </p>
            </section>
          );
        })}
        <p className="text-xs text-muted-foreground">Rates only fill in the entry form – staff may change the amounts. Service charge = Collected − Paid. All changes are in the change log.</p>
      </div>
    </>
  );
}
