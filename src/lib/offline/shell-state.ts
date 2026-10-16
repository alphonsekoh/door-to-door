import { useSyncExternalStore } from "react";

/*
 * Whether the offline shell is what this page is showing, and whose queue it
 * has been told to run. The shell is reached by the service worker's
 * navigation fallback, so the address is whatever failed to load
 * (/blocks/<id>, say), not /offline: the nav, the bar and the queue follow
 * this, never the path. Nor the session: offline it cannot be fetched, and
 * the cookie may name someone else (D-77-10).
 */

export type ShellState = { active: boolean; ownerId: string | null };

const OFF: ShellState = { active: false, ownerId: null };

let state = OFF;
const listeners = new Set<() => void>();

function set(next: ShellState): void {
  state = next;
  for (const listener of listeners) listener();
}

export const shellState = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): ShellState => state,
  getServerSnapshot: (): ShellState => OFF,
  /* Shown, with nobody confirmed yet: no queue runs until someone is. */
  enter(): void {
    set({ active: true, ownerId: null });
  },
  /* "Continue as <name>" was tapped. */
  continueAs(ownerId: string): void {
    set({ active: true, ownerId });
  },
  leave(): void {
    set(OFF);
  },
};

export function useShellState(): ShellState {
  return useSyncExternalStore(
    shellState.subscribe,
    shellState.getSnapshot,
    shellState.getServerSnapshot,
  );
}
