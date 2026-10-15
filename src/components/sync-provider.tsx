"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import {
  type SyncController,
  type SyncSnapshot,
  createSyncController,
} from "@/lib/sync/controller";
import type { VisitDraft } from "@/lib/sync/enqueue";
import { sharedQueue } from "@/lib/sync/idb-queue";
import { isSending } from "@/lib/sync/sync-ui";
import { type SignedIn, fetchSignedIn, sendAs } from "@/lib/sync/signed-in";
import { sendBatch } from "@/lib/sync/transport";
import type { QueuedVisit, Send, SyncQueue } from "@/lib/sync/types";
import { useRole } from "@/lib/use-role";
import { isPublicPath } from "@/server/auth/routes";

/*
 * The offline queue for the signed-in member (#33). One controller per
 * member per page; when someone else signs in on the same phone, theirs
 * replaces it and the first member's records stay on disk untouched until
 * they are back (D-33-1).
 */

const CHANNEL = "door-to-door-sync";
const LOCK = "door-to-door-sync";

export type SyncQueueValue = SyncSnapshot & {
  ownerId: string | undefined;
  /* Null while the queue is unavailable: no IndexedDB, nobody signed in, or
     not opened yet. The form then saves straight to the server. */
  enqueue: ((draft: VisitDraft) => Promise<QueuedVisit>) | null;
  retry: (id: string) => void;
  retryAll: () => void;
};

const EMPTY: SyncSnapshot = {
  records: [],
  inFlight: new Set(),
  justSaved: new Set(),
  block: null,
  syncedVersion: 0,
};

const INACTIVE: SyncQueueValue = {
  ...EMPTY,
  ownerId: undefined,
  enqueue: null,
  retry: () => undefined,
  retryAll: () => undefined,
};

const SyncContext = createContext<SyncQueueValue>(INACTIVE);

export function useSyncQueue(): SyncQueueValue {
  return useContext(SyncContext);
}

type Live = { ownerId: string; controller: SyncController; snapshot: SyncSnapshot };

/* Origin-wide, so two tabs never send at once (D-33-7). Where the browser has
   no Web Locks, the server's idempotency still keeps a double send harmless. */
function exclusive(run: () => Promise<void>): Promise<void> {
  return "locks" in navigator ? navigator.locks.request(LOCK, run).then(() => undefined) : run();
}

/* Asked once; iOS mostly says no, which changes nothing here. */
function persist(): Promise<unknown> {
  return Promise.resolve().then(() => navigator.storage.persist());
}

export function SyncProvider({
  children,
  openQueue = sharedQueue,
  send = sendBatch,
  signedIn = fetchSignedIn,
}: {
  children: ReactNode;
  openQueue?: () => Promise<SyncQueue | null>;
  send?: Send;
  signedIn?: () => Promise<SignedIn>;
}) {
  const { userId } = useRole();
  const pathname = usePathname();
  /* The last member confirmed signed in on this page. Auth.js refetches the
     session when the app comes back into view, and a refetch that fails for
     want of signal reads as signed out until the next page load; the queue
     must not switch off in a stairwell for that. A real sign-out navigates
     to a public page, or to a fresh page load; someone else signing in
     brings their own id, which replaces this one (D-33-1). A sign-out in
     another tab does neither, so every send first asks the server who is
     signed in, and an answer naming anyone else lets go of this member. */
  const [confirmed, setConfirmed] = useState<string | undefined>(undefined);
  const ownerId = isPublicPath(pathname) ? undefined : (userId ?? confirmed);
  if (ownerId !== confirmed) setConfirmed(ownerId);
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    if (ownerId === undefined) return;
    let cancelled = false;
    let stop: () => void = () => undefined;

    void openQueue().then((queue) => {
      if (cancelled || queue === null) return;
      const channel =
        typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
      const controller = createSyncController({
        queue,
        ownerId,
        send: sendAs(ownerId, send, signedIn, () => {
          setConfirmed(undefined);
        }),
        now: Date.now,
        random: Math.random,
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (handle) => {
          window.clearTimeout(handle as number);
        },
        exclusive,
        announce: () => channel?.postMessage("changed"),
        persist,
        onChange: (snapshot) => {
          setLive({ ownerId, controller, snapshot });
        },
      });

      const wake = () => void controller.wake();
      const onVisible = () => {
        if (document.visibilityState === "visible") wake();
      };
      if (channel !== null) channel.onmessage = () => void controller.refresh();
      window.addEventListener("online", wake);
      window.addEventListener("focus", wake);
      document.addEventListener("visibilitychange", onVisible);
      stop = () => {
        controller.dispose();
        channel?.close();
        window.removeEventListener("online", wake);
        window.removeEventListener("focus", wake);
        document.removeEventListener("visibilitychange", onVisible);
      };
      void controller.start();
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [ownerId, openQueue, send, signedIn]);

  const current = live !== null && live.ownerId === ownerId ? live : null;
  const value: SyncQueueValue =
    current === null
      ? INACTIVE
      : {
          ...current.snapshot,
          ownerId: current.ownerId,
          enqueue: current.controller.enqueue,
          retry: (id) => void current.controller.retry(id),
          retryAll: () => void current.controller.retryAll(),
        };

  /* Closing the page loses nothing, the queue is on disk, but a member
     walking away mid-send should know it has not gone yet. */
  const sending = value.inFlight.size > 0 || value.records.some(isSending);
  useEffect(() => {
    if (!sending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [sending]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
