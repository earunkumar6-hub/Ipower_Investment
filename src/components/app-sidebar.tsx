"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { MenuItem } from "@/lib/menu";
import { cn } from "@/lib/utils";

export function AppSidebar({ items, userName, roleLabel }: { items: MenuItem[]; userName: string; roleLabel: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col bg-brand-800 text-white/80">
      <div className="px-4 py-5 text-center">
        <Image src="/logo.png" alt="IPower Investments logo" width={64} height={64} priority className="mx-auto mb-2" />
        <div className="text-lg font-semibold leading-tight text-white">IPower Investments</div>
        <div className="text-xs text-saffron-200">Smart Investments For Good Life</div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href}
              className={cn("block rounded-md px-3 py-2 text-sm hover:bg-white/10 hover:text-white",
                active && "bg-saffron-500 font-medium text-brand-900 hover:bg-saffron-500 hover:text-brand-900")}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-xs">
        <div className="font-medium text-white">{userName}</div>
        <div className="mb-2">{roleLabel}</div>
        <button onClick={signOut} className="underline hover:text-white">Sign out</button>
      </div>
    </aside>
  );
}
