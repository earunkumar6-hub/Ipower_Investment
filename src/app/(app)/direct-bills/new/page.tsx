import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { payOptions } from "@/lib/payment-options";
import { requirePermission } from "@/lib/session";
import { DirectBillForm } from "./direct-bill-form";

export default async function NewDirectBillPage() {
  const user = await requirePermission("Receipt.Create");
  const opts = await payOptions(db, user.tenantId);
  return (
    <>
      <PageHeader title="New direct bill" user={user} />
      <DirectBillForm modes={opts.modes} banks={opts.banks} receivedBy={user.name} />
    </>
  );
}
