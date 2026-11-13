import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "Showing 51–100 of 2,000" with Previous / Next links; keeps the other query parameters (D-03). */
export function Pager({ page, pageSize, total, params, path }: {
  page: number; pageSize: number; total: number; params: Record<string, string | undefined>; path: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: p > 1 ? String(p) : undefined }).filter((e): e is [string, string] => !!e[1]));
    return q.size ? `${path}?${q}` : path;
  };
  const from = (page - 1) * pageSize + 1, to = Math.min(page * pageSize, total);
  const link = (p: number, label: string, disabled: boolean) => disabled
    ? <span className={cn(buttonVariants({ size: "sm", variant: "outline" }), "pointer-events-none opacity-50")} aria-disabled="true">{label}</span>
    : <Link href={href(p)} className={buttonVariants({ size: "sm", variant: "outline" })}>{label}</Link>;
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</span>
      <span className="flex items-center gap-2">
        {link(page - 1, "Previous", page <= 1)}
        <span>Page {page} of {pages}</span>
        {link(page + 1, "Next", page >= pages)}
      </span>
    </nav>
  );
}
