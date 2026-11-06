import type { AttachmentOwner } from "@prisma/client";
import type { Tx } from "@/lib/db";

// Dropdown values kept in Settings (`DropdownOption`). Removing a value hides it from new entries; old records keep the text.
// Every list also offers "Other": the typed value is saved with the entry and added to the list, tagged "added by staff".

export const DROPDOWN_LISTS = {
  expensePurpose: "Expense purposes",
  quotationCategory: "Quotation products",
  attachmentQuotation: "File types – quotations",
  attachmentProposal: "File types – proposals",
  attachmentCustomer: "File types – customers",
  attachmentTicket: "File types – tickets",
} as const;
export type DropdownList = keyof typeof DROPDOWN_LISTS;
export const OTHER = "Other";

/** Starting values for a new agency (the migrations add the same for existing ones). */
export const DEFAULT_DROPDOWN_VALUES: Record<DropdownList, string[]> = {
  expensePurpose: ["Stationery", "Rent", "Utilities", "Travel", "Repairs", "Equipment", "Office", "Staff salary", "Marketing", "Pooja", "Customer incentives", "Bank charges"],
  quotationCategory: ["Health", "Life", "Motor", "Personal accident", "Mutual fund"],
  attachmentQuotation: ["Health declaration", "Brochure"],
  attachmentProposal: ["Aadhaar", "PAN", "Photo", "Proposal form"],
  attachmentCustomer: ["Aadhaar", "PAN", "Policy document", "Bank passbook"],
  attachmentTicket: ["Screenshot", "Error message"],
};

export const ATTACHMENT_LIST: Record<AttachmentOwner, DropdownList> = {
  Quotation: "attachmentQuotation",
  Proposal: "attachmentProposal",
  Customer: "attachmentCustomer",
  Ticket: "attachmentTicket",
};

/** Active values of a list, in display order ("Other" not included). */
export async function dropdownValues(tx: Pick<Tx, "dropdownOption">, tenantId: string, list: DropdownList) {
  const rows = await tx.dropdownOption.findMany({ where: { tenantId, list, active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => r.value);
}

/** The stored value matching `value` case-insensitively (active or not), so "pooja" and "Pooja" stay one entry. */
export function findDropdownValue(tx: Pick<Tx, "dropdownOption">, tenantId: string, list: DropdownList, value: string) {
  return tx.dropdownOption.findFirst({ where: { tenantId, list, value: { equals: value.trim(), mode: "insensitive" } } });
}

/** Serialises adds to one list so two people typing the same value at once don't create it twice. */
export async function lockDropdown(tx: Tx, tenantId: string, list: DropdownList) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dropdown:${tenantId}:${list}`}))`;
}

/**
 * The value to save for a dropdown with "Other": a picked value must be in the active list; "Other" needs the typed
 * text, which is added to the list for next time (unless an Admin removed it – then it is saved on this entry only).
 */
export async function resolveDropdown(
  tx: Tx, user: { id: string; tenantId: string }, list: DropdownList, picked: string, typed: string,
): Promise<{ value: string } | { error: string; other: boolean }> {
  if (picked !== OTHER) {
    const values = await dropdownValues(tx, user.tenantId, list);
    return values.includes(picked) ? { value: picked } : { error: "Pick a value from the list", other: false };
  }
  const text = typed.trim().replace(/\s+/g, " ");
  if (text.length < 2) return { error: "Type the value for 'Other'", other: true };
  if (text.length > 60) return { error: "Keep it under 60 characters", other: true };
  if (text.toLowerCase() === OTHER.toLowerCase()) return { error: "Type what it is, not 'Other'", other: true };
  await lockDropdown(tx, user.tenantId, list);
  const same = await findDropdownValue(tx, user.tenantId, list, text);
  if (same) return { value: same.value };
  await tx.dropdownOption.create({ data: { tenantId: user.tenantId, list, value: text, addedByStaff: true, sort: 1000, createdById: user.id } });
  return { value: text };
}
