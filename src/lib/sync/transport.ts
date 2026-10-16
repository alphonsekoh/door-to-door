import { zSyncVisitsResponse } from "@/generated/zod.gen";
import type { VisitSyncItem, VisitSyncRequest, VisitSyncResponse } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import type { SendOutcome } from "@/lib/sync/types";

/*
 * One POST /visits/sync. Through apiFetch on purpose (D-33-5): a 401 or a
 * deactivated account then raises the account screen exactly as any other
 * request does (D-85-10), with no second path into the account store.
 *
 * `sentAt` is read at the moment of sending, every attempt (D-76-3): the
 * server compares it with its own clock, and a stamp from the first try
 * would read as skew on the tenth.
 */

/* A request that went out and never came back (signal lost mid-send) must
   not hold up the queue until the browser gives up. The records stay queued
   and their ids make a resend harmless if the server did get it. */
export const SEND_TIMEOUT_MS = 20_000;

export async function sendBatch(
  items: VisitSyncItem[],
  now: () => Date = () => new Date(),
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<SendOutcome> {
  const body: VisitSyncRequest = { sentAt: now().toISOString(), items };
  let response: unknown;
  try {
    response = await apiFetch<unknown>("/visits/sync", {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { kind: "http", status: error.status, code: error.code };
    }
    /* A 200 that is not JSON fails in apiFetch's parse; anything else thrown
       there is fetch itself giving up, or the timeout. */
    return error instanceof SyntaxError ? { kind: "invalid" } : { kind: "network" };
  }
  /* Checked, then used as parsed JSON: zod's output types every optional
     field as possibly undefined, which the contract's types forbid. */
  if (!zSyncVisitsResponse.safeParse(response).success) return { kind: "invalid" };
  return { kind: "ok", results: (response as VisitSyncResponse).results };
}
