import { FileSpreadsheet, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { Params } from "@/lib/lists";
import { hasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

/** Excel and PDF download links for a report, carrying the screen's current filters. */
export function exportLinks(report: string, params: Params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const pdf = new URLSearchParams(qs);
  pdf.set("format", "pdf");
  return { excel: `/api/export/${report}${qs.size ? `?${qs}` : ""}`, pdf: `/api/export/${report}?${pdf}` };
}

/** "Download Excel" / "Download PDF" for Admin and Super Admin; passes the screen's current filters to the export. */
export function ExportButton({ report, user, params = {} }: { report: string; user: SessionUser; params?: Params }) {
  if (!hasPermission(user.role, "Report.Export")) return null;
  const links = exportLinks(report, params);
  return (
    <>
      <a href={links.excel} download className={buttonVariants({ variant: "outline" })}>
        <FileSpreadsheet className="text-green-700" />
        Download Excel
      </a>
      <a href={links.pdf} download className={buttonVariants({ variant: "outline" })}>
        <FileText className="text-red-700" />
        Download PDF
      </a>
    </>
  );
}
