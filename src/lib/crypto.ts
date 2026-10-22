import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// Field encryption for sensitive values (bank details): AES-256-GCM with DATA_ENCRYPTION_KEY
// (32 random bytes, base64) from the environment. Stored as "v1:<iv>:<tag>:<ciphertext>" in base64 parts.

export class EncryptionKeyMissing extends Error {
  constructor() {
    super("Bank details can't be saved: DATA_ENCRYPTION_KEY is not set on the server (see deploy/INSTALL.md)");
    this.name = "EncryptionKeyMissing";
  }
}

function key() {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw || raw === "change-me") throw new EncryptionKeyMissing();
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new EncryptionKeyMissing();
  return k;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptJson<T>(stored: string): T {
  const [v, iv, tag, body] = stored.split(":");
  if (v !== "v1") throw new Error("Unknown encrypted value format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8")) as T;
}

/** "XXXXXX1234" – how an account number is shown. */
export const maskAccount = (n: string) => (n.length > 4 ? `${"X".repeat(Math.min(n.length - 4, 8))}${n.slice(-4)}` : n);

/**
 * Keyed fingerprint (HMAC-SHA256) of an identity number, for uniqueness and matching without storing it in clear.
 * Keyed so a 12-digit Aadhaar can't be found by hashing every possible number.
 */
export function fingerprint(kind: "aadhaar" | "pan", value: string) {
  return createHmac("sha256", key()).update(`${kind}:${value}`).digest("base64");
}
