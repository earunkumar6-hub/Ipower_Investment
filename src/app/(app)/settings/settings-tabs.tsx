import Link from "next/link";
import { cn } from "@/lib/utils";

// More tabs may follow (fields and rules, approval limits, reminders).
const TABS = [
  ["products", "Products and schemes", "/settings"],
  ["accounts", "Bank accounts and wallets", "/settings/accounts"],
  ["payment-modes", "Payment modes", "/settings/payment-modes"],
  ["expense-purposes", "Expense purposes", "/settings/expense-purposes"],
  ["daybook", "Day Book", "/settings/daybook"],
  ["log", "Change log", "/settings/log"],
] as const;

export function SettingsTabs({ active }: { active: (typeof TABS)[number][0] }) {
  return (
    <div className="mb-4 flex gap-1 border-b">
      {TABS.map(([key, label, href]) => (
        <Link key={key} href={href}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {label}
        </Link>
      ))}
    </div>
  );
}
