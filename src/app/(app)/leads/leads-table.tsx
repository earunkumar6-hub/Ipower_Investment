"use client";

import type { LeadSource, LeadStage, LeadStatus } from "@prisma/client";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, maskMobile } from "@/lib/lead-labels";
import { cn } from "@/lib/utils";

export type LeadRow = {
  id: string;
  leadNo: string;
  name: string;
  mobile: string;
  source: LeadSource;
  referrerName: string | null;
  interest: string | null;
  status: LeadStatus;
  stage: LeadStage;
  nextCallAt: string | null;
  ownerName: string;
};

const IST = "Asia/Kolkata";
const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });

function NextCall({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  const at = new Date(iso);
  if (at.getTime() <= Date.now()) return <span className="font-medium text-orange-700">Call open – overdue</span>;
  const time = at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
  if (day(at) === day(new Date())) return <>Today {time}</>;
  return <>{at.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST })} {time}</>;
}

const col = createColumnHelper<LeadRow>();
const columns = [
  col.accessor("leadNo", { header: "Lead no." }),
  col.accessor("name", { header: "Name" }),
  col.accessor("mobile", { header: "Mobile", cell: (c) => maskMobile(c.getValue()), enableSorting: false }),
  col.accessor("source", {
    header: "Business type",
    cell: (c) => <>{LEAD_SOURCE_LABEL[c.getValue()]}{c.row.original.referrerName && <div className="text-xs text-muted-foreground">{c.row.original.referrerName}</div>}</>,
  }),
  col.accessor("interest", {
    header: "Interested product",
    cell: (c) => (c.getValue() ? <div className="max-w-40 truncate" title={c.getValue()!}>{c.getValue()}</div> : <span className="text-muted-foreground">—</span>),
  }),
  col.accessor("status", {
    header: "Status",
    cell: (c) => <>
      <StatusBadge tone={LEAD_STATUS_TONE[c.getValue()]}>{LEAD_STATUS_LABEL[c.getValue()]}</StatusBadge>
      {c.row.original.stage !== "Lead" && <div className="text-xs text-muted-foreground">{LEAD_STAGE_LABEL[c.row.original.stage]}</div>}
    </>,
  }),
  col.accessor("nextCallAt", { header: "Next call", cell: (c) => <span className="whitespace-nowrap"><NextCall iso={c.getValue()} /></span>, sortUndefined: "last" }),
  col.accessor("ownerName", { header: "Owner" }),
];

export function LeadsTable({ rows, selectedId }: { rows: LeadRow[]; selectedId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function select(id: string) {
    const next = new URLSearchParams(params);
    next.set("id", id);
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((h) => (
              <TableHead key={h.id} onClick={h.column.getToggleSortingHandler()}
                className={cn(h.column.getCanSort() && "cursor-pointer select-none")}>
                {flexRender(h.column.columnDef.header, h.getContext())}
                {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} onClick={() => select(row.original.id)}
            className={cn("cursor-pointer", row.original.id === selectedId && "bg-saffron-50 hover:bg-saffron-50")}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
            ))}
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">No leads match these filters.</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
