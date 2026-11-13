// QA D-05: every server action that changes data writes a change-log entry (audit()) in the same transaction.
// A new action that writes without one fails here – add the entry, or list the action below with the reason.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../app/(app)");
const NOT_LOGGED: Record<string, string> = {
  // These only write the "Sent messages" log (itself the record of what was sent) or a system alert.
  alertLowBalance: "system alert message", shareOnWhatsApp: "Sent messages log", sendRenewalReminder: "Sent messages log",
  sendMaturityReminder: "Sent messages log", sendRemindersBulk: "Sent messages log",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /actions\.ts$/.test(f) ? [p] : [];
  });
}

describe("change-log coverage of server actions", () => {
  it("every action that writes to the database calls audit()", () => {
    const missing: string[] = [];
    for (const file of files(ROOT)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes('"use server"')) continue;
      for (const block of src.split(/\n(?=(?:export )?async function )/).slice(1)) {
        const name = /^(?:export )?async function (\w+)/.exec(block)![1];
        const writes = /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|postReceipt|postExpense|reverseSource|payDueLine/.test(block);
        if (writes && !block.includes("audit(") && !(name in NOT_LOGGED)) missing.push(`${path.relative(ROOT, file)} › ${name}`);
      }
    }
    expect(missing, `actions that change data but write no change-log entry:\n${missing.join("\n")}`).toEqual([]);
  });
});
