"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { searchCustomers } from "../actions";
import { PROPOSAL_FORM } from "./proposal-forms";

type Holder = { id: string; name: string; cifNo: string; mobile: string; address: string | null; pan: string | null; aadhaarLast4: string | null };
type Picked = { id: string; name: string; cifNo: string; mobile: string };

/**
 * Joint account (#12): first holder = the proposal's customer; second holder = an existing customer (search by
 * name, CIF or mobile) or a new person (name + mobile), who becomes a customer with a CIF when the policy is issued.
 * Its boxes belong to the proposal's one form (`form` attribute) and are saved by "Save proposal".
 */
export function JointAccountPanel({ issued, first, joint, second, newSecond, cifs, kind, folio }: {
  issued: boolean;
  /** Post office: company CIF boxes; mutual fund: folio number; insurance: neither (owner, 3 Nov 2026). */
  kind: "postal" | "mf" | "other";
  folio: string | null;
  first: { name: string; cifNo: string | null; note: string | null };
  joint: boolean; second: Holder | null; newSecond: { name: string; mobile: string } | null;
  /** CIFs given by the post office / insurer to each holder. */
  cifs: { first: string | null; second: string | null };
}) {
  const [on, setOn] = useState(joint);
  const [mode, setMode] = useState<"existing" | "new">(newSecond ? "new" : "existing");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Picked[]>([]);
  const [picked, setPicked] = useState<Picked | null>(second && { id: second.id, name: second.name, cifNo: second.cifNo, mobile: second.mobile });

  useEffect(() => {
    if (mode !== "existing" || q.trim().length < 2) return setResults([]);
    let live = true;
    const t = setTimeout(() => searchCustomers(q).then((r) => live && setResults(r)), 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, mode]);

  const firstLine = <>{first.name} · <span className="text-muted-foreground">Customer ID</span> {first.cifNo ?? <span className="text-muted-foreground">given when the policy is issued</span>}{first.note && <span className="block text-xs text-muted-foreground">{first.note}</span>}</>;

  const postal = kind === "postal";
  const cifText = (cif: string | null) => postal && <> · post office CIF <b>{cif ?? "—"}</b></>;
  const folioLine = kind === "mf" && <p>Folio number <b>{folio ?? "—"}</b></p>;

  if (issued) {
    if (!joint) {
      return (postal && cifs.first) || folioLine
        ? <div className="rounded-lg border p-3 text-sm"><h3 className="mb-1 font-medium">Account holder</h3><p>{firstLine}{cifText(cifs.first)}</p>{folioLine}</div>
        : null;
    }
    return (
      <div className="rounded-lg border p-3 text-sm">
        <h3 className="mb-2 font-medium">Joint account</h3>
        <p>First holder: {firstLine}{cifText(cifs.first)}</p>
        <p>Second holder: {second ? <Link href={`/customers/${second.id}`} className="text-brand-700 hover:underline">{second.name} · Customer ID {second.cifNo}</Link> : "—"}{cifText(cifs.second)}</p>
        {folioLine}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <input type="hidden" form={PROPOSAL_FORM} name="jointAccount" value={on ? "on" : "off"} />
      <h3 className="font-medium">Account holders</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><div className="text-xs text-muted-foreground">{on ? "First holder name" : "Holder name"}</div><div>{firstLine}</div></div>
        {postal && (
          <div className="space-y-1">
            <Label htmlFor="jh-cif1" className="text-xs">{on ? "First holder CIF" : "Holder CIF"} (given by the post office)</Label>
            <Input id="jh-cif1" form={PROPOSAL_FORM} name="firstHolderCif" defaultValue={cifs.first ?? ""} placeholder="e.g. PO CIF" className="h-8" />
          </div>
        )}
        {kind === "mf" && (
          <div className="space-y-1">
            <Label htmlFor="folioNo" className="text-xs">Folio number (given by the AMC)</Label>
            <Input id="folioNo" form={PROPOSAL_FORM} name="folioNo" defaultValue={folio ?? ""} placeholder="e.g. 1234567/89" className="h-8 not-placeholder-shown:uppercase" />
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} aria-label="Joint account" /> Joint account
      </label>
      {on && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {postal ? (
              <div className="space-y-1">
                <Label htmlFor="jh-cif2" className="text-xs">Second holder CIF (given by the post office)</Label>
                <Input id="jh-cif2" form={PROPOSAL_FORM} name="secondHolderCif" defaultValue={cifs.second ?? ""} className="h-8" />
              </div>
            ) : <div />}
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Second holder</div>
              <div className="flex gap-1">
                {(["existing", "new"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={cn("h-7 flex-1 rounded-md border px-2 text-xs", mode === m ? "border-brand-600 bg-saffron-50 font-medium text-brand-700" : "hover:bg-slate-50")}>
                    {m === "existing" ? "Existing customer" : "New person"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {mode === "existing" ? (
            <div className="space-y-2">
              <input type="hidden" form={PROPOSAL_FORM} name="secondHolderId" value={picked?.id ?? ""} />
              {picked ? (
                <div className="flex items-center justify-between rounded-md bg-slate-50 p-2">
                  <span>Second holder name: <b>{picked.name}</b> · Customer ID {picked.cifNo} · {picked.mobile}</span>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setPicked(null)}>Change</Button>
                </div>
              ) : (
                <div className="relative">
                  <Label htmlFor="jh-search" className="text-xs">Find by name, CIF or mobile</Label>
                  <Input id="jh-search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} placeholder="e.g. Ravi or CIF-000012" className="h-8" />
                  {results.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button type="button" onClick={() => { setPicked(r); setQ(""); }} className="flex w-full justify-between px-2 py-1.5 text-left hover:bg-slate-100">
                            <span>{r.name} · {r.cifNo}</span><span className="text-muted-foreground">{r.mobile}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <input type="hidden" form={PROPOSAL_FORM} name="secondHolderId" value="" />
              <div className="space-y-1"><Label htmlFor="jh-name" className="text-xs">Second holder name</Label><Input id="jh-name" form={PROPOSAL_FORM} name="secondHolderName" defaultValue={newSecond?.name} className="h-8" /></div>
              <div className="space-y-1"><Label htmlFor="jh-mobile" className="text-xs">Mobile</Label><Input id="jh-mobile" form={PROPOSAL_FORM} name="secondHolderMobile" defaultValue={newSecond?.mobile} inputMode="numeric" maxLength={10} className="h-8" /></div>
              <p className="col-span-2 text-xs text-muted-foreground">A customer with this mobile is linked instead; otherwise a new customer (with a CIF) is created when the policy is issued.</p>
            </div>
          )}
          {second && joint && (
            <div className="rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-900">
              Existing customer selected: <Link href={`/customers/${second.id}`} className="font-medium underline">{second.name} ({second.cifNo})</Link> – details filled in automatically:
              {" "}mobile {second.mobile}{second.address && ` · ${second.address}`}{second.aadhaarLast4 && ` · Aadhaar XXXX-XXXX-${second.aadhaarLast4}`}{second.pan && ` · PAN ${second.pan}`}
            </div>
          )}
          {newSecond && joint && mode === "new" && <p className="text-xs text-saffron-900">Second holder {newSecond.name} becomes a customer when the policy is issued.</p>}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {postal && "CIF: optional until the policy is issued; enter it like the policy number. "}
        {kind === "mf" && "Folio number: leave blank until the AMC gives it; with it, Save proposal issues the investment. Several SIPs can share one folio. "}
        Customer ID (CIF-000…) is this CRM&apos;s own number. Saved with &ldquo;Save proposal&rdquo;.
      </p>
    </div>
  );
}
