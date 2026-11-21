import type { Role } from "@/db/schema";

/*
 * What the server last said about the signed-in account, shared across every
 * screen. apiFetch reports into it; the shell reads it to raise one
 * full-screen message instead of each screen offering a Try again that can
 * only fail again.
 */

/* What the account message covers the app with. */
export type AccountFailure = "deactivated" | "signed-out";

/* "unapproved" is never a message: the shell takes the account to the
   waiting page instead (#249). */
export type AuthFailure = AccountFailure | "unapproved";

export type ServerUser = { id: string; role: Role };

export type AccountSnapshot = {
  failure: AuthFailure | null;
  serverUser: ServerUser | null;
};

export type AccountStore = {
  getSnapshot: () => AccountSnapshot;
  getServerSnapshot: () => AccountSnapshot;
  subscribe: (listener: () => void) => () => void;
  reportAuthFailure: (kind: AuthFailure) => void;
  noteCurrentUser: (user: ServerUser) => void;
};

/* A plain 403 refuses one action (a team change, an admin route after a
   demotion) and the screen that asked already explains it. */
export function classifyAuthFailure(status: number, code: string | undefined): AuthFailure | null {
  if (status === 401) return "signed-out";
  if (status !== 403) return null;
  if (code === "account_deactivated") return "deactivated";
  if (code === "account_pending" || code === "account_blocked") return "unapproved";
  return null;
}

const INITIAL_SNAPSHOT: AccountSnapshot = { failure: null, serverUser: null };

export function createAccountStore(): AccountStore {
  let snapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  const publish = (next: AccountSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    /* The server knows nothing of what this browser was told, and hydration
       must match what it rendered. */
    getServerSnapshot: () => INITIAL_SNAPSHOT,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /* First wins and sticks: every way out is a full page load, which starts a
       fresh store, and flipping between two messages would only confuse. */
    reportAuthFailure(kind) {
      if (snapshot.failure !== null) return;
      publish({ ...snapshot, failure: kind });
    },
    noteCurrentUser({ id, role }) {
      publish({ ...snapshot, serverUser: { id, role } });
    },
  };
}

export const accountStore = createAccountStore();
