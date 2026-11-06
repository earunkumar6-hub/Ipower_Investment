import type { Permission } from "@/lib/permissions";

export type MenuItem = { href: string; label: string; permission?: Permission };

export const MENU: MenuItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leads", label: "Leads", permission: "Lead.View" },
  { href: "/followups", label: "Follow-ups", permission: "Lead.View" },
  { href: "/quotations", label: "Quotations", permission: "Quote.View" },
  { href: "/proposals", label: "Proposals", permission: "Proposal.View" },
  { href: "/customers", label: "Partners / Customers", permission: "Policy.View" },
  { href: "/renewals", label: "Renewals", permission: "Renewal.View" },
  { href: "/receipts", label: "Receipts", permission: "Receipt.View" },
  { href: "/esevai", label: "E-Sevai", permission: "Service.Record" },
  { href: "/expenses", label: "Expenses", permission: "Expense.View" },
  { href: "/daybook", label: "Day Book", permission: "DayBook.View" },
  // Commission received is hidden for now (owner, 23 Oct 2026); the page still works at /commission. To show it again:
  // { href: "/commission", label: "Commission", permission: "Commission.View" },
  { href: "/pnl", label: "Profit & Loss", permission: "PnL.View" },
  { href: "/messages", label: "Sent messages", permission: "Message.View" },
  { href: "/tickets", label: "Tickets", permission: "Ticket.Create" },
  { href: "/settings", label: "Settings", permission: "Settings.Edit" },
];
