import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PO_SCHEMES, PRODUCT_SHORT, RD_STATUSES, RENEWAL_PRODUCTS, type receiptFilter } from "@/lib/lists";
import { MODE_LABEL } from "@/lib/payment-modes";

type Filter = ReturnType<typeof receiptFilter>;

/** Filter bar above every Receipts tab: a plain GET form, so the filters live in the address and the export link. */
export function ReceiptFilters({ f, tab, accounts, groups }: { f: Filter; tab: string; accounts: { id: string; label: string }[]; groups: { id: string; name: string }[] }) {
  const cls = "h-8 w-full";
  return (
    <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border bg-white p-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
      <input type="hidden" name="tab" value={tab} />
      {f.deposit !== "all" && <input type="hidden" name="deposit" value={f.deposit} />}
      <Input id="rf-q" name="q" defaultValue={f.q} placeholder="Name or mobile" aria-label="Name or mobile" className={cls} />
      <NativeSelect name="group" defaultValue={f.group ?? ""} aria-label="Bill group" className={cls}>
        <NativeSelectOption value="">Any bill group</NativeSelectOption>
        {groups.map((g) => <NativeSelectOption key={g.id} value={g.id}>{g.name}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect name="product" defaultValue={f.product} aria-label="Product" className={cls}>
        {RENEWAL_PRODUCTS.map(([k, label]) => <NativeSelectOption key={k} value={k}>{label}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect name="scheme" defaultValue={f.scheme ?? ""} aria-label="Post office scheme" className={cls}>
        <NativeSelectOption value="">All post office schemes</NativeSelectOption>
        {PO_SCHEMES.map((s) => <NativeSelectOption key={s} value={s}>{PRODUCT_SHORT[s]}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect name="rd" defaultValue={f.rd ?? ""} aria-label="RD status" className={cls}>
        <NativeSelectOption value="">Any RD status</NativeSelectOption>
        {RD_STATUSES.map((s) => <NativeSelectOption key={s} value={s}>RD {s.toLowerCase()}</NativeSelectOption>)}
      </NativeSelect>
      <Input id="rf-policy" name="policy" defaultValue={f.policyNo} placeholder="Policy / account no." aria-label="Policy / account no." className={cls} />
      <NativeSelect name="mode" defaultValue={f.mode ?? ""} aria-label="Payment mode" className={cls}>
        <NativeSelectOption value="">All modes</NativeSelectOption>
        {Object.entries(MODE_LABEL).map(([k, label]) => <NativeSelectOption key={k} value={k}>{label}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect name="account" defaultValue={f.account ?? ""} aria-label="Account" className={cls}>
        <NativeSelectOption value="">All accounts</NativeSelectOption>
        {accounts.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.label}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect name="status" defaultValue={f.status ?? ""} aria-label="Status" className={cls}>
        <NativeSelectOption value="">Any status</NativeSelectOption>
        <NativeSelectOption value="Saved">Saved</NativeSelectOption>
        <NativeSelectOption value="Cancelled">Cancelled</NativeSelectOption>
      </NativeSelect>
      <label className="flex items-center gap-1"><span className="shrink-0 text-muted-foreground">From</span><DmyDateInput id="rf-from" name="from" defaultValue={f.from} className={cls} /></label>
      <label className="flex items-center gap-1"><span className="shrink-0 text-muted-foreground">To</span><DmyDateInput id="rf-to" name="to" defaultValue={f.to} className={cls} /></label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline">Filter</Button>
        {f.active && <Link href={`/receipts?tab=${tab}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>Clear</Link>}
      </div>
    </form>
  );
}
