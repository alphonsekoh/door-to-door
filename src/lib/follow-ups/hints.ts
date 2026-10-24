/*
 * What this phone has already been told: first-use hints dismissed, and
 * declined suggestions acknowledged. Kept in localStorage, so per phone, not
 * per account; there is no schema for UI state. Storage that cannot be used
 * (private browsing, a full disk) shows the hint again rather than failing.
 */

const HINT_PREFIX = "d2d:hint:";
const SEEN_DECLINED = "d2d:declined-seen";
/* A dismissal elsewhere on the page, so every copy of a hint hides at once. */
export const HINTS_CHANGED = "d2d:hints-changed";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Shown again next time; nothing else depends on it.
  }
  window.dispatchEvent(new Event(HINTS_CHANGED));
}

export function isHintDismissed(id: string): boolean {
  return read(HINT_PREFIX + id) === "1";
}

export function dismissHint(id: string): void {
  write(HINT_PREFIX + id, "1");
}

export function seenDeclined(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(read(SEEN_DECLINED) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function markDeclinedSeen(id: string): void {
  markAllDeclinedSeen([id]);
}

/* One write for many, so "Got it to all" is one storage change. */
export function markAllDeclinedSeen(ids: readonly string[]): void {
  write(SEEN_DECLINED, JSON.stringify([...new Set([...seenDeclined(), ...ids])]));
}
