import type { Block } from "@/lib/sync/classify";
import { formatDay } from "@/lib/history/dates";
import { RETENTION_PERIODS } from "@/lib/privacy/policy";
import { isCorrupt, isErased } from "@/lib/sync/record";
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
      return isErased(record) ? "Not kept" : "Sent";
  }
}

const CLOCK = "Your phone's date or time is wrong. Fix it, then tap Retry.";
const REFUSED = "The server would not accept this record. Ask an admin.";

/* Why this one record is where it is, or null when its state says enough. */
export function recordReason(record: QueuedVisit): string | null {
  if (isErased(record)) {
    return "This unit's records were erased after you saved this, so it was not kept.";
  }
  if (isCorrupt(record)) return "This record could not be read on this phone.";
  const code = record.lastError?.code;
  switch (record.state) {
    case "quarantined":
      return "Could not send after several tries.";
    case "held":
      switch (code) {
        case "session_not_active":
          return "The session has ended. Sends if an admin reopens it.";
        case "not_on_follow_up_list":
          return "Not on this session's list. Sends once an admin adds this unit.";
        default:
          return REFUSED;
      }
    case "queued":
      /* The second refusal in a row: restamping did not help. */
      return code === "clock_skew" && record.skewCount > 1 ? CLOCK : null;
    default:
      return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * A record still unsent 30 days after it was saved is deleted when the app
 * next starts (D-279), whatever it is stuck on, so every unsent row says
 * when, before it goes - from the day it is saved, so the date is never a
 * surprise.
 */
export function deleteNote(record: QueuedVisit): string | null {
  if (record.state === "synced") return null;
  if (record.enqueuedAt <= 0) return "Deleted from this phone the next time the app opens.";
  const on = formatDay(record.enqueuedAt + RETENTION_PERIODS.unsentRecordDays * DAY_MS);
  return `Deleted from this phone on ${on} if not sent.`;
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
  if (unsent.length === 0) {
    /* Settled, but not kept: the member should hear that, for the day the stub lasts. */
    const notKept = records.filter((r) => isErased(r) && !justSaved.has(r.id)).length;
    return notKept === 0 ? null : { count: notKept, text: `${String(notKept)} not kept` };
  }
  const count = unsent.length;
  const stuck = unsent.some((r) => r.state === "held" || r.state === "quarantined");
  return { count, text: stuck ? `${String(count)} not sent` : `${String(count)} waiting to send` };
}

/* The sheet's title says what the bar said: "waiting" until something is
   actually stuck, and only then "not sent". */
export function queueTitle(records: readonly QueuedVisit[]): string {
  const stuck = records.some((r) => r.state === "held" || r.state === "quarantined");
  if (stuck) return "Records not sent";
  return records.length > 0 && records.every(isErased) ? "Records not kept" : "Waiting to send";
}

/* What the bar reads when it has nothing to count. A record saved on this
   page and still on its first send is not done yet. */
export function quietText(records: readonly QueuedVisit[], justSaved: ReadonlySet<string>): string {
  return records.some((r) => r.state !== "synced" && justSaved.has(r.id))
    ? "Sending…"
    : "All visits sent";
}

/* Records that keep a reload of the app waiting (D-32-6 as refined by
   D-33): only what this member's queue is actively trying to send. */
export function isSending(record: QueuedVisit): boolean {
  return record.state === "queued" || record.state === "failed";
}

/* The offline shell's count: every one of this member's records not yet on
   the server, stuck ones included, because all of them are only here. */
export function savedOnPhoneText(records: readonly QueuedVisit[]): string {
  const count = records.filter((r) => r.state !== "synced").length;
  if (count === 0) return "Nothing is waiting to send on this phone.";
  return count === 1
    ? "1 record is saved on this phone."
    : `${String(count)} records are saved on this phone.`;
}
