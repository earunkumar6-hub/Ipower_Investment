// Several mobile numbers per lead / customer: repeated `mobile` form fields, and `whatsApp` holding the
// indexes ticked "Same as WhatsApp". The first number is the main one.

export type MobileEntry = { number: string; isWhatsApp: boolean };

const mobileRe = /^[6-9]\d{9}$/;

export function readMobiles(form: FormData): { numbers: MobileEntry[] } | { error: string } {
  const raw = form.getAll("mobile").map((m) => String(m).trim());
  const ticked = new Set(form.getAll("whatsApp").map(String));
  const numbers = raw.map((number, i) => ({ number, isWhatsApp: ticked.has(String(i)) })).filter((m) => m.number);
  if (numbers.length === 0) return { error: "Enter at least one mobile number" };
  const bad = numbers.find((m) => !mobileRe.test(m.number));
  if (bad) return { error: `${bad.number} is not a 10-digit mobile number` };
  if (new Set(numbers.map((m) => m.number)).size !== numbers.length) return { error: "The same number is entered twice" };
  return { numbers };
}

/** "98400 12000 (WhatsApp), 94…" for summaries and the change log. */
export const mobilesText = (ms: MobileEntry[]) => ms.map((m) => `${m.number}${m.isWhatsApp ? " (WhatsApp)" : ""}`).join(", ");
