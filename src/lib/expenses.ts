import type { ApprovalLevel, Expense, ExpenseStatus, Prisma, Role } from "@prisma/client";
import { D } from "@/lib/money";

// Approval limits (fixed for the demo; a Super Admin setting in the full build).
export const AUTO_LIMIT = new D(2000);
export const ADMIN_LIMIT = new D(5000);

/**
 * ≤ ₹2,000: saved without approval. ₹2,001–₹5,000: Admin. Above ₹5,000: Super Admin.
 * An Admin cannot approve their own expense, so an Admin's mid-range expense goes to the Super Admin.
 */
export function approvalLevelFor(amount: Prisma.Decimal.Value, creatorRole: Role): ApprovalLevel {
  const a = new D(amount);
  if (a.lte(AUTO_LIMIT)) return "None";
  if (a.lte(ADMIN_LIMIT)) return creatorRole === "Admin" ? "SuperAdmin" : "Admin";
  return "SuperAdmin";
}

export function canApprove(user: { id: string; role: Role }, e: Pick<Expense, "status" | "approvalLevel" | "createdById">) {
  if (e.status !== "Waiting") return false;
  if (user.role === "SuperAdmin") return true;
  return user.role === "Admin" && e.approvalLevel === "Admin" && e.createdById !== user.id;
}

/** Users cancel their own; Admin and Super Admin any. Rejected / cancelled ones are final. */
export function canCancel(user: { id: string; role: Role }, e: Pick<Expense, "status" | "createdById">) {
  if (e.status === "Cancelled" || e.status === "Rejected") return false;
  return user.role !== "User" || e.createdById === user.id;
}

const LEVEL: Record<ApprovalLevel, string> = { None: "", Admin: "Admin", SuperAdmin: "Super Admin" };

/** `paid`: company money has left (a live Day Book entry exists). */
export function expenseStatusLabel(e: Pick<Expense, "status" | "approvalLevel" | "paidBy" | "repaymentStatus">, paid: boolean): [string, "orange" | "green" | "indigo" | "slate" | "red"] {
  const repay = e.paidBy !== "Company" ? (e.repaymentStatus === "Repaid" ? " · repaid" : " · to be repaid") : "";
  const s: ExpenseStatus = e.status;
  if (s === "Waiting") return [`Waiting – ${LEVEL[e.approvalLevel]}`, "orange"];
  if (s === "Approved" && e.paidBy === "Company" && !paid) return [`Approved – ${LEVEL[e.approvalLevel]} · to be paid`, "indigo"];
  if (s === "Approved") return [`Approved – ${LEVEL[e.approvalLevel]}${repay}`, "green"];
  if (s === "Saved") return [`Saved${repay}`, repay.includes("to be") ? "indigo" : "green"];
  if (s === "Rejected") return ["Rejected", "red"];
  return ["Cancelled", "slate"];
}

