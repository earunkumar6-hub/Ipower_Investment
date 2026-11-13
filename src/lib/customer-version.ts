// Edit clash check for "Edit details" (D-02, owner 13 Nov 2026): the form carries the details it was opened with;
// the save is refused when the customer has changed since (someone else saved first), instead of overwriting it.
// Client-safe (used by the form and the server action).

type Snapshot = { name: string; email: string | null; address: string | null; mobiles: { number: string; isWhatsApp: boolean }[] };

export const customerVersion = (c: Snapshot) =>
  JSON.stringify([c.name.trim(), (c.email ?? "").trim(), (c.address ?? "").trim(), c.mobiles.map((m) => [m.number, m.isWhatsApp])]);
