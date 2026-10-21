import type { Tx } from "@/lib/db";

// Dropdown values kept in Settings (`DropdownOption`). Removing a value hides it from new entries; old records keep the text.

export const DROPDOWN_LISTS = { expensePurpose: "Expense purposes" } as const;
export type DropdownList = keyof typeof DROPDOWN_LISTS;

/** Active values of a list, in display order. */
export async function dropdownValues(tx: Pick<Tx, "dropdownOption">, tenantId: string, list: DropdownList) {
  const rows = await tx.dropdownOption.findMany({ where: { tenantId, list, active: true }, orderBy: [{ sort: "asc" }, { value: "asc" }] });
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
