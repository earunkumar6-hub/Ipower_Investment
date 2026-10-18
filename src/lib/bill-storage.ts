import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Demo stand-in for object storage: files live in ./storage/bills, outside /public,
// and are served only through an authorised route.
const DIR = path.join(process.cwd(), "storage", "bills");
export const MAX_BILL_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export function billProblem(file: File | null): string | null {
  if (!file || file.size === 0) return null;
  if (!TYPES[file.type]) return "Bill must be a JPG, PNG, WEBP photo or a PDF";
  if (file.size > MAX_BILL_BYTES) return "Bill file must be 5 MB or smaller";
  return null;
}

/** Saves the bill and returns the stored file name (kept on the Expense). */
export async function saveBill(file: File, expenseId: string) {
  await mkdir(DIR, { recursive: true });
  const name = `${expenseId}.${TYPES[file.type]}`;
  await writeFile(path.join(DIR, name), Buffer.from(await file.arrayBuffer()));
  return name;
}

export async function readBill(name: string) {
  const ext = path.extname(name).slice(1);
  const type = Object.entries(TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return { body: await readFile(path.join(DIR, path.basename(name))), type };
}
