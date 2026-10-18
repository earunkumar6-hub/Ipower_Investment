import type { ActionResult } from "@/app/(app)/leads/actions";
import { DayClosedError } from "@/lib/daybook";

/**
 * For actions that move money: a closed Day Book becomes a friendly refusal
 * instead of a server error. Decisions that move no money don't need this.
 */
export async function refuseOnClosedDay(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DayClosedError) return { ok: false, error: `${e.message}. Money can be recorded again on the next open day.` };
    throw e;
  }
}
