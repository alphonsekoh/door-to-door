import type { Block } from "@/lib/sync/classify";
import { isCorrupt } from "@/lib/sync/record";
import type { QueuedVisit } from "@/lib/sync/types";

/*
 * Every word the queue shows. Fixed text only: the server's own message is
 * never displayed, because it was written for a request, not for a record
 * that may be days old by the time anyone reads it.
 */

export const QUEUE_NOTE =
  "Records not sent are on this phone only. Teammates see them once they are sent.";

export function stateLabel(record: QueuedVisit, inFlight: ReadonlySet<string>): string {
  if (inFlight.has(record.id)) return "Sending…";
  switch (record.state) {
    case "queued":
      return "Waiting to send";
    case "failed":
      return "Will retry";
    case "held":
      return "Held";
    case "quarantined":
      return "Stopped";
    case "synced":
      return "Sent";
  }
}

const CLOCK = "Your phone's date or time is wrong. Fix it, then tap Retry.";
const REFUSED = "The server would not accept this record. Ask an admin.";

/* Why this one record is where it is, or null when its state says enough. */
export function recordReason(record: QueuedVisit): string | null {
  if (isCorrupt(record)) return "This record could not be read on this phone.";
  const code = record.lastError?.code;
  switch (record.state) {
    case "quarantined":
      return "Could not send after several tries.";
    case "held":
      return code === "session_not_active"
        ? "The outing has ended. Sends if an admin reopens it."
        : REFUSED;
    case "queued":
      /* The second refusal in a row: restamping did not help. */
      return code === "clock_skew" && record.skewCount > 1 ? CLOCK : null;
    default:
      return null;
  }
}

/* Why nothing is going out at all. */
export function blockReason(block: Block | null): string | null {
  switch (block?.reason) {
    case "offline":
      return "No signal. Sends when you're back online.";
    case "clock":
      return CLOCK;
    case "server":
    case "rate_limited":
      return "The server is busy. Trying again shortly.";
    case "signed_out":
      return "Signed out. Sends when you sign in again.";
    case "deactivated":
      return "This account is deactivated. Records wait here until an admin restores it.";
    case undefined:
      return null;
  }
}

export type BarSummary = { count: number; text: string };

/*
 * Null when there is nothing to show. A record saved on this page does not
 * count until its first send is over, so saving with signal never flashes
 * the bar (D-33-12).
 */
export function barSummary(
  records: readonly QueuedVisit[],
  justSaved: ReadonlySet<string>,
): BarSummary | null {
  const unsent = records.filter((r) => r.state !== "synced" && !justSaved.has(r.id));
  if (unsent.length === 0) return null;
  const count = unsent.length;
  const stuck = unsent.some((r) => r.state === "held" || r.state === "quarantined");
  return { count, text: stuck ? `${String(count)} not sent` : `${String(count)} waiting to send` };
}

/* Records that keep a reload of the app waiting (D-32-6 as refined by
   D-33): only what this member's queue is actively trying to send. */
export function isSending(record: QueuedVisit): boolean {
  return record.state === "queued" || record.state === "failed";
}
