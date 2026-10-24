import { useSyncExternalStore } from "react";
import type { SessionKind } from "@/generated/types.gen";

/*
 * The kind of session running, as this page last heard it: null when none
 * was, undefined before anything was heard. A screen opened from another
 * then starts from what that one learnt, rather than guessing until its own
 * answer comes back. In memory only, so a reload starts unknown, and the
 * server's HTML always is.
 */

let kind: SessionKind | null | undefined;
const listeners = new Set<() => void>();

export const knownSessionKind = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): SessionKind | null | undefined => kind,
  getServerSnapshot: (): undefined => undefined,
  note(next: SessionKind | null): void {
    if (next === kind) return;
    kind = next;
    for (const listener of listeners) listener();
  },
  /* For tests: a fresh page. */
  forget(): void {
    kind = undefined;
  },
};

export function useKnownSessionKind(): SessionKind | null | undefined {
  return useSyncExternalStore(
    knownSessionKind.subscribe,
    knownSessionKind.getSnapshot,
    knownSessionKind.getServerSnapshot,
  );
}
