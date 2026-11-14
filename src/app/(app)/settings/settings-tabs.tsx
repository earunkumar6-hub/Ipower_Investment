import Link from "next/link";
import { hasPermission } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";

// More tabs may follow (fields and rules, approval limits, reminders).
const TABS = [
  ["products", "Products and schemes", "/settings"],
  ["accounts", "Bank accounts and wallets", "/settings/accounts"],
  ["payment-modes", "Payment modes", "/settings/payment-modes"],
  ["esevai-rates", "Esevai & CSC rates", "/settings/esevai-rates"],
  ["dropdowns", "Dropdown values", "/settings/dropdowns"],
  ["daybook", "Day Book", "/settings/daybook"],
  ["log", "Change log", "/settings/log"],
  ["roles", "Roles and access", "/settings/roles"], // Super Admin only
  ["users", "Users", "/settings/users"], // Super Admin only
] as const;
const OWNER_TABS = ["roles", "users"];

export async function SettingsTabs({ active }: { active: (typeof TABS)[number][0] }) {
  const user = await getSessionUser();
  const owner = !!user && hasPermission(user.role, "Access.Manage");
  return (
    <div className="mb-4 flex gap-1 border-b">
      {TABS.filter(([key]) => owner || !OWNER_TABS.includes(key)).map(([key, label, href]) => (
        <Link key={key} href={href}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {label}
        </Link>
      ))}
    </div>
  );
}
