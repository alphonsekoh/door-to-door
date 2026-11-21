"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { UserList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * How many people are waiting for an admin's approval (#249), for the badge
 * on the Admin tab and the card on the admin landing page. In the app only:
 * no email, and no polling. It is read once per page load, as the account
 * check is (D-85-7), and Team sets it after every change it makes there. A
 * read that fails leaves it unknown, which shows nothing.
 */

export type ApprovalCountStore = {
  getSnapshot: () => number | null;
  getServerSnapshot: () => number | null;
  subscribe: (listener: () => void) => () => void;
  /* Team's own count, after it has approved, rejected or unblocked someone. */
  set: (total: number) => void;
  /* The once-per-load read; every later call does nothing. */
  load: () => void;
};

export function createApprovalCountStore(): ApprovalCountStore {
  let count: number | null = null;
  let requested = false;
  /* Bumped by set(), so a read that set() overtook cannot put back a count
     from before the change. */
  let version = 0;
  const listeners = new Set<() => void>();

  const publish = (total: number) => {
    count = total;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => count,
    /* Unknown on the server, so hydration draws no badge either. */
    getServerSnapshot: () => null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(total) {
      version += 1;
      publish(total);
    },
    load() {
      if (requested) return;
      requested = true;
      const at = version;
      apiFetch<UserList>("/users?approval=pending&limit=1").then(
        (page) => {
          if (version === at) publish(page.pagination.total);
        },
        () => undefined,
      );
    },
  };
}

export const approvalCount = createApprovalCountStore();

/* The count, asked for once `enabled` holds: an admin, on a screen of the app. */
export function useApprovalCount(enabled: boolean): number | null {
  useEffect(() => {
    if (enabled) approvalCount.load();
  }, [enabled]);
  return useSyncExternalStore(
    approvalCount.subscribe,
    approvalCount.getSnapshot,
    approvalCount.getServerSnapshot,
  );
}

/* As a badge has room for it. */
export function badgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
