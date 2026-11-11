// Runs once when the server starts (dev server and Docker). Shows in `docker compose logs app`.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { encryptionKeyOk } = await import("@/lib/crypto");
  if (!encryptionKeyOk()) {
    console.warn(
      "\n!!! DATA_ENCRYPTION_KEY is missing, still \"change-me\" or not a 32-byte base64 key.\n" +
      "!!! Aadhaar / PAN and bank details can NOT be saved until it is set in .env (see deploy/INSTALL.md, step 4),\n" +
      "!!! then `docker compose up -d` to apply it.\n",
    );
  }
}
