import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";
import type { Role } from "@prisma/client";

// Permission names match the full build ("Subject.Action").
export const PERMISSIONS = [
  "Lead.View", "Lead.Create", "Lead.Edit",
  "Quote.View", "Quote.Create",
  "Proposal.View", "Proposal.Create", "PII.Edit",
  "Policy.View", "Policy.Create",
  "Renewal.View",
  "Receipt.View", "Receipt.Create", "Receipt.Cancel",
  "Service.Record", "Wallet.View", "Wallet.Recharge",
  "Expense.View", "Expense.Create", "Expense.Approve",
  "DayBook.View", "DayBook.Create", "DayBook.Verify", "DayBook.Close",
  "Commission.View",
  "PnL.View",
  "Message.View",
  "Report.Export",
  "Settings.Edit", "Audit.View",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
type Split<P> = P extends `${infer S}.${infer A}` ? [S, A] : never;
export type Subject = Split<Permission>[0];
export type Action = Split<Permission>[1];
export type AppAbility = MongoAbility<[Action, Subject]>;

const STAFF_DENIED: Permission[] = [
  "Receipt.Cancel", "Wallet.Recharge", "Expense.Approve",
  "DayBook.Verify", "DayBook.Close", "Commission.View", "PnL.View", "Report.Export",
  "Settings.Edit", "Audit.View",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SuperAdmin: PERMISSIONS,
  Admin: PERMISSIONS.filter((p) => p !== "PnL.View"),
  User: PERMISSIONS.filter((p) => !STAFF_DENIED.includes(p)),
};

export function defineAbilityFor(role: Role): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const p of ROLE_PERMISSIONS[role]) {
    const [subject, action] = p.split(".") as [Subject, Action];
    can(action, subject);
  }
  return build();
}

export const hasPermission = (role: Role, permission: Permission) =>
  ROLE_PERMISSIONS[role].includes(permission);

/** Users see records they own; Admin and Super Admin see the whole agency. */
export const seesAll = (role: Role) => role !== "User";

export const ROLE_LABEL: Record<Role, string> = { SuperAdmin: "Super Admin", Admin: "Admin", User: "User" };
