import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";
import type { Role } from "@prisma/client";

// Permission names match the full build ("Subject.Action").
export const PERMISSIONS = [
  "Lead.View", "Lead.Create", "Lead.Edit",
  "Quote.View", "Quote.Create",
  "Proposal.View", "Proposal.Create", "PII.Edit",
  "Policy.View", "Policy.Create",
  "Customer.Delete", // delete a customer that has no records (Admin, Super Admin)
  "Renewal.View",
  "Receipt.View", "Receipt.Create", "Receipt.Cancel",
  "BillGroup.Manage", // create bill groups, add / remove policies (Admin, Super Admin)
  "Service.Record", "Wallet.View", "Wallet.Recharge",
  "Expense.View", "Expense.Create", "Expense.Approve",
  "DayBook.View", "DayBook.Create", "DayBook.Verify", "DayBook.Close",
  "DayBook.CloseLate", // close a day after its grace period (Super Admin)
  "Owner.Confirm", // confirm / reject owner withdrawals and contributions (Super Admin)
  "Commission.View", // Commission received screen, its export and the P&L line (Super Admin)
  "PnL.View",
  "Message.View",
  "Report.Export",
  "Settings.Edit", "Audit.View",
  "Data.SeeAll", // see every customer / record, not only one's own
  "Access.Manage", // Settings → Roles and access, Users (Super Admin only, can't be given away)
] as const;

export type Permission = (typeof PERMISSIONS)[number];
type Split<P> = P extends `${infer S}.${infer A}` ? [S, A] : never;
export type Subject = Split<Permission>[0];
export type Action = Split<Permission>[1];
export type AppAbility = MongoAbility<[Action, Subject]>;

const STAFF_DENIED: Permission[] = [
  "Customer.Delete", "Receipt.Cancel", "BillGroup.Manage", "Wallet.Recharge", "Expense.Approve",
  "DayBook.Verify", "DayBook.Close", "DayBook.CloseLate", "Owner.Confirm", "Commission.View", "PnL.View", "Report.Export",
  "Settings.Edit", "Audit.View", "Data.SeeAll", "Access.Manage",
];

/** Only the owner (Super Admin) by default. */
const OWNER_ONLY: Permission[] = ["PnL.View", "DayBook.CloseLate", "Owner.Confirm", "Commission.View", "Access.Manage"];

/** Can't be changed on the Roles and access screen. Commission received stays Super Admin only (owner, 23 Oct 2026). */
export const LOCKED_PERMISSIONS: Permission[] = ["Access.Manage", "Commission.View"];

/** Built-in defaults; the Super Admin can change Admin and User in Settings → Roles and access. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SuperAdmin: PERMISSIONS,
  Admin: PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p)),
  User: PERMISSIONS.filter((p) => !STAFF_DENIED.includes(p)),
};

// Overrides saved in the database (RolePermission), loaded per request by `loadAccess` (src/lib/access.ts).
// This is a single-agency install, so one set is kept in memory.
let overrides: Partial<Record<Role, Partial<Record<Permission, boolean>>>> = {};
export function setAccessOverrides(o: typeof overrides) {
  overrides = o;
}

export const isDefaultAllowed = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);

export function hasPermission(role: Role, permission: Permission) {
  if (role === "SuperAdmin" || LOCKED_PERMISSIONS.includes(permission)) return isDefaultAllowed(role, permission);
  return overrides[role]?.[permission] ?? isDefaultAllowed(role, permission);
}

export function defineAbilityFor(role: Role): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const p of PERMISSIONS.filter((x) => hasPermission(role, x))) {
    const [subject, action] = p.split(".") as [Subject, Action];
    can(action, subject);
  }
  return build();
}

/** Admin and Super Admin see the whole agency by default; Users see records they own. */
export const seesAll = (role: Role) => hasPermission(role, "Data.SeeAll");

export const ROLE_LABEL: Record<Role, string> = { SuperAdmin: "Super Admin", Admin: "Admin", User: "User" };

/** Roles and access screen: every permission in plain words, grouped by area. */
export const PERMISSION_GROUPS: { area: string; items: [Permission, string][] }[] = [
  { area: "Leads and follow-ups", items: [["Lead.View", "See leads and follow-ups"], ["Lead.Create", "Add leads, schedule calls"], ["Lead.Edit", "Edit leads"]] },
  { area: "Quotations and proposals", items: [["Quote.View", "See quotations"], ["Quote.Create", "Make quotations"], ["Proposal.View", "See proposals"], ["Proposal.Create", "Make / edit proposals"], ["PII.Edit", "Enter Aadhaar / PAN"]] },
  { area: "Customers and renewals", items: [["Policy.View", "See customers and holdings"], ["Policy.Create", "Issue policies, add products, edit customers"], ["Customer.Delete", "Delete customers that have no records"], ["Renewal.View", "See renewals"], ["Data.SeeAll", "See every staff member's customers and records"]] },
  { area: "Receipts", items: [["Receipt.View", "See receipts"], ["Receipt.Create", "Take receipts, direct bills"], ["Receipt.Cancel", "Cancel receipts"], ["BillGroup.Manage", "Create / change bill groups"]] },
  { area: "E-Sevai", items: [["Service.Record", "Record E-Sevai entries"], ["Wallet.View", "See wallets"], ["Wallet.Recharge", "Recharge wallets"]] },
  { area: "Expenses", items: [["Expense.View", "See expenses"], ["Expense.Create", "Add expenses"], ["Expense.Approve", "Approve expenses"]] },
  {
    area: "Day Book", items: [["DayBook.View", "See the Day Book"], ["DayBook.Create", "Post Day Book entries (ATM, deposits, owner money)"], ["DayBook.Verify", "Verify the cash count"],
      ["DayBook.Close", "Close the day, record other income"], ["DayBook.CloseLate", "Close a day after the grace period"], ["Owner.Confirm", "Confirm / reject owner money"]],
  },
  { area: "Money reports", items: [["Commission.View", "Commission received"], ["PnL.View", "Profit & Loss"], ["Report.Export", "Download Excel / PDF"], ["Message.View", "See sent messages"]] },
  { area: "Settings", items: [["Settings.Edit", "Change settings"], ["Audit.View", "See the change log"], ["Access.Manage", "Roles and access, users (Super Admin only)"]] },
];
