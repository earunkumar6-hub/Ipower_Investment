import { FileSpreadsheet, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { Params } from "@/lib/lists";
import { hasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

/** "Download Excel" / "Download PDF" for Admin and Super Admin; passes the screen's current filters to the export. */
export function ExportButton({ report, user, params = {} }: { report: string; user: SessionUser; params?: Params }) {
  if (!hasPermission(user.role, "Report.Export")) return null;
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const pdf = new URLSearchParams(qs);
  pdf.set("format", "pdf");
  return (
    <>
      <a href={`/api/export/${report}${qs.size ? `?${qs}` : ""}`} download className={buttonVariants({ variant: "outline" })}>
        <FileSpreadsheet className="text-green-700" />
        Download Excel
      </a>
      <a href={`/api/export/${report}?${pdf}`} download className={buttonVariants({ variant: "outline" })}>
        <FileText className="text-red-700" />
        Download PDF
      </a>
    </>
  );
}
