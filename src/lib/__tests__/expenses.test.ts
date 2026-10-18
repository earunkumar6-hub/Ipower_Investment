import { describe, expect, it } from "vitest";
import { approvalLevelFor, canApprove, canCancel } from "@/lib/expenses";

describe("Expense approval routing", () => {
  it("routes by amount", () => {
    expect(approvalLevelFor("2000", "User")).toBe("None");
    expect(approvalLevelFor("2000.01", "User")).toBe("Admin");
    expect(approvalLevelFor("3200", "User")).toBe("Admin");
    expect(approvalLevelFor("5000", "User")).toBe("Admin");
    expect(approvalLevelFor("5000.01", "User")).toBe("SuperAdmin");
    expect(approvalLevelFor("38000", "Admin")).toBe("SuperAdmin");
  });

  it("an Admin's own mid-range expense goes to the Super Admin", () => {
    expect(approvalLevelFor("4800", "Admin")).toBe("SuperAdmin");
  });

  it("who can approve", () => {
    const admin = { id: "a", role: "Admin" as const }, owner = { id: "o", role: "SuperAdmin" as const }, staff = { id: "s", role: "User" as const };
    const adminLevel = { status: "Waiting" as const, approvalLevel: "Admin" as const, createdById: "s" };
    expect(canApprove(admin, adminLevel)).toBe(true);
    expect(canApprove(owner, adminLevel)).toBe(true);
    expect(canApprove(staff, adminLevel)).toBe(false);
    expect(canApprove(admin, { ...adminLevel, createdById: "a" })).toBe(false);
    expect(canApprove(admin, { ...adminLevel, approvalLevel: "SuperAdmin" })).toBe(false);
    expect(canApprove(owner, { ...adminLevel, status: "Approved" })).toBe(false);
  });

  it("who can cancel", () => {
    const e = { status: "Waiting" as const, createdById: "s" };
    expect(canCancel({ id: "s", role: "User" }, e)).toBe(true);
    expect(canCancel({ id: "x", role: "User" }, e)).toBe(false);
    expect(canCancel({ id: "a", role: "Admin" }, e)).toBe(true);
    expect(canCancel({ id: "a", role: "Admin" }, { ...e, status: "Cancelled" })).toBe(false);
  });
});
