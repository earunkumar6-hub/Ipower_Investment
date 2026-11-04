import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Customer photos live in ./storage/photos (outside /public) and are served only by /api/customers/[id]/photo
// after the same owner check as the customer page.
const DIR = path.join(process.cwd(), "storage", "photos");
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

export function photoProblem(file: File | null): string | null {
  if (!file || file.size === 0) return "Choose a photo";
  if (!TYPES[file.type]) return "Photo must be a JPG or PNG";
  if (file.size > MAX_PHOTO_BYTES) return "Photo must be 2 MB or smaller";
  return null;
}

/** Saves the photo as <customerId>.<ext>, removing an older one of the other type; returns the stored name. */
export async function savePhoto(file: File, customerId: string, previous: string | null) {
  await mkdir(DIR, { recursive: true });
  const name = `${customerId}.${TYPES[file.type]}`;
  await writeFile(path.join(DIR, name), Buffer.from(await file.arrayBuffer()));
  if (previous && previous !== name) await unlink(path.join(DIR, path.basename(previous))).catch(() => {});
  return name;
}

export const deletePhoto = (name: string) => unlink(path.join(DIR, path.basename(name))).catch(() => {});

export async function readPhoto(name: string) {
  const ext = path.extname(name).slice(1);
  const type = Object.entries(TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return { body: await readFile(path.join(DIR, path.basename(name))), type };
}

/** "MR" for "Meena R" – shown when there is no photo. */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
