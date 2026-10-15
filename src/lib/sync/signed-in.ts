import { SEND_TIMEOUT_MS } from "@/lib/sync/transport";
import type { Send } from "@/lib/sync/types";

/*
 * Who the server says is signed in on this browser, asked before every send
 * (D-33-1). The page's own idea of the member can be stale: a sign-out in
 * another tab, then someone else signing in, leaves this tab holding the
 * first member's queue while the cookie is already the second's. The sync
 * request carries no owner, so the server would store the first member's
 * records as the second's. Only the cookie's own answer can rule that out.
 */

/* `id` is null when nobody is. `unknown` when the question went unanswered. */
export type SignedIn = { kind: "member"; id: string | null } | { kind: "unknown" };

function memberId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("user" in body)) return null;
  const { user } = body;
  if (typeof user !== "object" || user === null || !("id" in user)) return null;
  return typeof user.id === "string" && user.id !== "" ? user.id : null;
}

export async function fetchSignedIn(timeoutMs = SEND_TIMEOUT_MS): Promise<SignedIn> {
  try {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { kind: "unknown" };
    return { kind: "member", id: memberId(await response.json()) };
  } catch {
    return { kind: "unknown" };
  }
}

/* A send that goes out only while `ownerId` is the one signed in. Anyone
   else, or nobody, reads as signed out, which pauses the queue until a new
   page load; `onOtherMember` lets the page drop that member's queue. */
export function sendAs(
  ownerId: string,
  send: Send,
  signedIn: () => Promise<SignedIn>,
  onOtherMember: () => void,
): Send {
  return async (items) => {
    const answer = await signedIn();
    /* Waits like no signal does: never charged to a record, since the
       records were not even sent. */
    if (answer.kind === "unknown") return { kind: "network" };
    if (answer.id !== ownerId) {
      onOtherMember();
      return { kind: "http", status: 401, code: "unauthorized" };
    }
    return send(items);
  };
}
