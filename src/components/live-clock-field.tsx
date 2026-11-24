"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDateTime } from "@/lib/dates";

/** Read-only "Date and time" box that shows the current IST date and time while a record is being entered (updates every 30 s). */
export function LiveClockField({ label = "Date and time", id = "entered-at" }: { label?: string; id?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} readOnly tabIndex={-1} value={now ? fmtDateTime(now) : ""} className="bg-slate-50" />
    </div>
  );
}
