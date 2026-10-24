import type { RevisitEntry, RevisitList } from "@/generated/types.gen";
import { zRevisitList } from "@/generated/zod.gen";
import { SEND_TIMEOUT_MS } from "@/lib/sync/transport";

/*
 * A follow-up session's list as the server holds it now, for the offline
 * shell once signal is back. Not apiFetch: a refusal here must not raise the
 * account message over a visit half typed in a stairwell, and one bar of
 * signal must not leave it hanging. Null for anything but the list, so the
 * copy's list stands.
 */
export async function readRevisits(
  outingId: string,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<RevisitEntry[] | null> {
  try {
    const response = await fetch(`/api/sessions/${outingId}/revisits`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return zRevisitList.safeParse(body).success ? (body as RevisitList).data : null;
  } catch {
    return null;
  }
}
