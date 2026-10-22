import { PageHeader } from "@/components/page-header";
import { bankAccountOptions } from "@/lib/accounts";
import { istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { payOptions } from "@/lib/payment-options";
import { POLICY_BILLS_INCLUDE, policyOptions, presetCounts } from "@/lib/receipt-options";
import { requirePermission } from "@/lib/session";
import { GroupReceiptForm } from "../../group-receipt-form";

/** Combined receipt (#5): tick open bills across any customers (a User: their own customers) → one receipt. */
export default async function NewCombinedReceiptPage({ searchParams }: { searchParams: Promise<{ bills?: string }> }) {
  const user = await requirePermission("Receipt.Create");
  const billIds = ((await searchParams).bills ?? "").split(",").filter(Boolean);
  const policies = await db.policy.findMany({
    where: { tenantId: user.tenantId, status: "Active", customer: ownerScope(user), renewals: { some: { status: { in: ["Due", "Overdue"] } } } },
    include: POLICY_BILLS_INCLUDE,
  });
  const [opts, accounts] = await Promise.all([payOptions(db, user.tenantId), bankAccountOptions(db, user.tenantId)]);
  const all = policyOptions(policies, istToday(), true);
  // From Renewals with ticked rows: show only the ticked customers' policies.
  const preset = billIds.length ? presetCounts(all, billIds) : undefined;
  const options = preset ? all.filter((p) => p.id in preset) : all;
  return (
    <>
      <PageHeader title="New combined receipt" user={user} />
      <GroupReceiptForm kind="Combined" policies={options} preset={preset} payer={{ name: "", mobile: "" }}
        modes={opts.modes} banks={opts.banks} accounts={accounts} receivedBy={user.name} />
    </>
  );
}
