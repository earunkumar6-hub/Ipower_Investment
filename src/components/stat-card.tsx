import Link from "next/link";
import { cn } from "@/lib/utils";

/** Summary card; with `href` the whole card opens the matching filtered list. */
export function StatCard({ title, value, sub, highlight, href, alert }: { title: string; value: string; sub?: string; highlight?: boolean; href?: string; alert?: boolean }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className={cn("mt-1 text-xl font-semibold", alert && "text-destructive")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </>
  );
  const cls = cn("block rounded-xl border bg-white p-4", highlight && "border-blue-500 ring-1 ring-blue-500");
  return href ? <Link href={href} className={cn(cls, "transition-colors hover:border-blue-400 hover:bg-blue-50/40")}>{body}</Link> : <div className={cls}>{body}</div>;
}
