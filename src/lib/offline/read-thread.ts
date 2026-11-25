import type { HouseholdHistory } from "@/generated/types.gen";
import { zGetHouseholdHistoryResponse } from "@/generated/zod.gen";
import { historyPath } from "@/lib/households/history-pages";
import { SEND_TIMEOUT_MS } from "@/lib/sync/transport";

/*
 * A unit's newest page of history, read in the background to keep a thread
 * on the phone. Not apiFetch, as read-revisits.ts: a refusal here must not
 * raise the account message over a visit half typed, and one bar of signal
 * must not leave it hanging. Null for anything but the history.
 */
export async function readThread(
  householdId: string,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<HouseholdHistory | null> {
  try {
    const response = await fetch(`/api${historyPath(householdId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return zGetHouseholdHistoryResponse.safeParse(body).success ? (body as HouseholdHistory) : null;
  } catch {
    return null;
  }
}
