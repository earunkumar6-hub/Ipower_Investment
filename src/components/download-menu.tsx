"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { Fragment } from "react";
import { buttonVariants } from "@/components/ui/button";

export type DownloadGroup = { title: string; items: { label: string; href: string; kind: "excel" | "pdf" }[] };

/** One "Download ▾" button whose menu lists Excel / PDF files, grouped under small headings. */
export function DownloadMenu({ groups }: { groups: DownloadGroup[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={buttonVariants({ variant: "outline" })}>
        <Download />Download<ChevronDown className="transition-transform group-data-popup-open/button:rotate-180" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="min-w-60 rounded-xl border bg-white p-1.5 shadow-lg shadow-brand-900/10 outline-none">
            {groups.map((g, gi) => (
              <Fragment key={g.title}>
                {gi > 0 && <Menu.Separator className="my-1 h-px bg-border" />}
                <Menu.Group>
                  <Menu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">{g.title}</Menu.GroupLabel>
                  {g.items.map((i) => (
                    <Menu.LinkItem key={i.href} href={i.href} download closeOnClick
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none data-highlighted:bg-saffron-50 data-highlighted:text-brand-800">
                      {i.kind === "pdf" ? <FileText className="size-4 text-red-700" /> : <FileSpreadsheet className="size-4 text-green-700" />}
                      {i.label}
                    </Menu.LinkItem>
                  ))}
                </Menu.Group>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
