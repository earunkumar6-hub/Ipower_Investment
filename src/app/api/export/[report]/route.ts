import { db } from "@/lib/db";
import { xlsxResponse } from "@/lib/excel";
import { REPORTS } from "@/lib/exports";
import { reportPdf } from "@/lib/pdf-report";
import { hasPermission } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

// Excel (default) or PDF (`?format=pdf`) download of a list screen: Admin and Super Admin only, plus the screen's own permission.
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const report = REPORTS[(await params).report];
  if (!report) return new Response("Not found", { status: 404 });
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Report.Export") || !hasPermission(user.role, report.permission)) {
    return new Response("Not allowed", { status: 403 });
  }
  const { format, ...sp } = Object.fromEntries(new URL(request.url).searchParams);
  const [built, tenant] = await Promise.all([
    report.build(user, sp),
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true } }),
  ]);
  if (!built) return new Response("Not found", { status: 404 });
  if (format !== "pdf") return xlsxResponse(built.file, tenant.name, built.title, built.sheets);

  const pdf = await reportPdf(tenant.name, built.title, built.sheets);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${built.file.replace(/\.xlsx$/, ".pdf")}"` },
  });
}
