"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BlockViews } from "@/components/blocks/block-views";
import { DockHost } from "@/components/ui/docked-actions";
import { PageHeader } from "@/components/ui/page-header";
import { ReloadWhenOnline } from "@/components/pwa/reload-when-online";
import { useSyncQueue } from "@/components/sync/sync-provider";
import { goTo } from "@/lib/session/navigate";
import {
  type LocalBlock,
  type LocalCopy,
  type UsableCopy,
  offlineRows,
  usableCopy,
} from "@/lib/offline/local-copy";
import { loadLocalCopy } from "@/lib/offline/local-copy-store";
import { shellState } from "@/lib/offline/shell-state";
import { type SignedIn, fetchSignedIn } from "@/lib/sync/signed-in";
import type { OutingAnswer } from "@/lib/sync/outing";
import { savedOnPhoneText } from "@/lib/sync/sync-ui";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";

/*
 * What a reload in a dead zone opens (#77): the service worker's navigation
 * fallback serves the static /offline page, and this reads the last member's
 * local copy at runtime, so nothing about anyone is in the cached HTML
 * (D-32-4). Nobody records until "Continue as <name>": offline, the phone
 * cannot know who is holding it.
 *
 * Every navigation from here would be another cold reload into this page,
 * dropping the form, so blocks are in-page state, the nav is hidden, and the
 * only way out is Continue once the server answers, asked first if the form
 * has input. Sending needs no reload: the queue wakes on `online` itself.
 */

export const PROBE_INTERVAL_MS = 30_000;

type Phase =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "gate"; copy: UsableCopy }
  | { kind: "recording"; copy: UsableCopy };

const NO_TEAM: readonly string[] = [];

/* The address the fallback was shown at is where the member was going. */
function returnTarget(): string {
  const { pathname, search } = window.location;
  return pathname === "/offline" ? "/" : pathname + search;
}

/*
 * Whether the server can be reached now. Any answer will do, even "nobody
 * signed in": the real screens can deal with that. Not `navigator.onLine`,
 * which says online in a dead zone with one bar. A record reaching the server
 * proves it as well as a probe does, and often sooner. It keeps asking once
 * answered, and `offline` drops it at once, so Continue never offers a full
 * load into a dead zone, which would reload cold into the gate.
 */
function useReachable(probe: () => Promise<SignedIn>, syncedVersion: number): boolean {
  const [answered, setAnswered] = useState(false);
  /* Sends up to this version were before the signal was last lost. */
  const [lostAtVersion, setLostAtVersion] = useState(0);
  const version = useRef(syncedVersion);
  useEffect(() => {
    version.current = syncedVersion;
  }, [syncedVersion]);

  useEffect(() => {
    let cancelled = false;
    let asking = false;
    /* Bumped on each loss, so an answer to a question asked before it is
       ignored rather than undoing it. */
    let generation = 0;
    const lose = () => {
      setAnswered(false);
      setLostAtVersion(version.current);
    };
    const ask = () => {
      if (asking) return;
      asking = true;
      const askedIn = generation;
      void probe().then((answer) => {
        if (askedIn !== generation) return;
        asking = false;
        if (cancelled) return;
        if (answer.kind === "member") setAnswered(true);
        else lose();
      });
    };
    const onOffline = () => {
      generation += 1;
      asking = false;
      lose();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    ask();
    const timer = window.setInterval(ask, PROBE_INTERVAL_MS);
    window.addEventListener("online", ask);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", ask);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", ask);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", ask);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [probe]);

  return answered || syncedVersion > lostAtVersion;
}

export function OfflineShell({
  load = loadLocalCopy,
  probe = fetchSignedIn,
  navigate = goTo,
  now = Date.now,
}: {
  load?: () => Promise<LocalCopy | null>;
  probe?: () => Promise<SignedIn>;
  navigate?: (path: string) => void;
  now?: () => number;
}) {
  const sync = useSyncQueue();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [blockId, setBlockId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /* What to do once the member agrees to drop what they typed. */
  const [confirming, setConfirming] = useState<{ run: () => void } | null>(null);
  const reachable = useReachable(probe, sync.syncedVersion);

  /* Before paint, so the nav never shows and the Save bar sits on the
     bottom edge from the first frame. */
  useLayoutEffect(() => {
    shellState.enter();
    const root = document.documentElement.style;
    root.setProperty("--nav-height", "0px");
    return () => {
      shellState.leave();
      root.removeProperty("--nav-height");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load()
      .catch(() => null)
      .then((copy) => {
        if (cancelled) return;
        const usable = usableCopy(copy, now());
        setPhase(usable === null ? { kind: "none" } : { kind: "gate", copy: usable });
      });
    return () => {
      cancelled = true;
    };
  }, [load, now]);

  const unlessDirty = (run: () => void) => {
    if (dirty) setConfirming({ run });
    else run();
  };

  const picked =
    phase.kind === "recording"
      ? phase.copy.blocks.find((entry) => entry.block.id === blockId)
      : undefined;

  return (
    <DockHost className="space-y-5">
      {/*
        Once a block is open it is the title, inline with the way back to the
        blocks, as the online recording screen is: with the page's own title
        and a row for the block above it, the unit number opened under Save
        at large text.
      */}
      {picked === undefined ? (
        <PageHeader title="Offline" />
      ) : (
        <PageHeader
          title={`Blk ${picked.block.name}`}
          subtitle={picked.block.street}
          back={{
            label: "All blocks",
            onBack: () => {
              unlessDirty(() => {
                setBlockId(null);
              });
            },
          }}
          inline
        />
      )}

      {/*
        Held one line high, as high as Continue, so nothing moves when it
        turns up. It is what tells a member in a dead stairwell their records
        are safe, so it is never cut short: at large text it wraps, and
        Continue drops under it, and then the row may change height. Its edge
        is a ring, not a border, so the two are one height. Compact on a
        short screen, so the form is still in view under it.
      */}
      <div
        aria-live="polite"
        className="flex control-compact flex-wrap items-center gap-x-3 rounded-lg bg-surface-muted px-3 ring-1 ring-border ring-inset"
      >
        <span className="min-w-0 flex-[1_1_12ch]">
          {reachable ? "Back online." : "Offline. Records save on this phone."}
        </span>
        {reachable ? (
          <button
            type="button"
            onClick={() => {
              unlessDirty(() => {
                navigate(returnTarget());
              });
            }}
            className="ml-auto control-compact shrink-0 font-medium btn-text"
          >
            Continue
          </button>
        ) : null}
      </div>

      {/* Mounted from the first render, not once the copy is read: signal
          coming back while it loads would otherwise go unheard. */}
      {phase.kind === "recording" ? null : <ReloadWhenOnline />}

      {phase.kind === "loading" ? (
        <p className="text-body text-foreground-muted">Looking for what is saved on this phone…</p>
      ) : null}

      {phase.kind === "none" ? (
        <>
          <p className="text-body">
            Nothing is saved on this phone to record with. Connect and open your session first.
          </p>
          <form action="/" method="get">
            <button
              type="submit"
              className="min-h-12 btn-primary rounded-xl px-6 text-body font-semibold"
            >
              Try again
            </button>
          </form>
        </>
      ) : null}

      {phase.kind === "gate" ? (
        <>
          <button
            type="button"
            onClick={() => {
              shellState.continueAs(phase.copy.member.id);
              setPhase({ kind: "recording", copy: phase.copy });
            }}
            className="min-h-14 w-full btn-primary rounded-xl px-4 text-title font-semibold"
          >
            Continue as {phase.copy.member.name}
          </button>
          <p className="text-body text-foreground-muted">
            Not {phase.copy.member.name}? Sign in when you have signal.
          </p>
        </>
      ) : null}

      {phase.kind === "recording" ? (
        <Recording
          copy={phase.copy}
          picked={picked}
          records={sync.records}
          queueOpen={sync.enqueue !== null}
          onPick={setBlockId}
          onDirtyChange={setDirty}
        />
      ) : null}

      <SheetPresence>
        {confirming === null ? null : (
          <ConfirmDialog
            title="Leave without saving this visit?"
            detail="What you typed for this unit has not been saved."
            confirmLabel="Leave"
            busy={false}
            onConfirm={() => {
              setConfirming(null);
              confirming.run();
            }}
            onCancel={() => {
              setConfirming(null);
            }}
          />
        )}
      </SheetPresence>
    </DockHost>
  );
}

function Recording({
  copy,
  picked,
  records,
  queueOpen,
  onPick,
  onDirtyChange,
}: {
  copy: UsableCopy;
  picked: LocalBlock | undefined;
  records: ReturnType<typeof useSyncQueue>["records"];
  queueOpen: boolean;
  onPick: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const outingId = copy.outing.id;
  /* The copy's outing is the only one this page can know about. */
  const loadSession = useCallback(
    (): Promise<OutingAnswer> => Promise.resolve({ kind: "running", id: outingId }),
    [outingId],
  );

  /* A block open is the form alone, under its own title (above); the sync
     bar counts what is waiting meanwhile. */
  if (picked !== undefined) {
    return (
      <BlockViews
        blockId={picked.block.id}
        known={picked.households}
        rows={offlineRows(picked, records, outingId)}
        sessionId={outingId}
        loadSession={loadSession}
        onRecorded={() => undefined}
        teamIds={NO_TEAM}
        offline
        onDirtyChange={onDirtyChange}
      />
    );
  }

  return (
    <>
      <div>
        <p className="text-body font-medium">{copy.outing.title}</p>
        {/* Its line is held while the queue opens, so the list below stays put. */}
        <p className="min-h-6 text-body text-foreground-muted">
          {queueOpen ? savedOnPhoneText(records) : null}
        </p>
      </div>

      <ul className="space-y-2" aria-label="Blocks saved on this phone">
        {copy.blocks.map((entry) => (
          <li key={entry.block.id}>
            <button
              type="button"
              onClick={() => {
                onPick(entry.block.id);
              }}
              className="flex min-h-16 w-full press flex-col justify-center rounded-xl border border-border bg-surface px-4 py-3 text-left"
            >
              <span className="block text-title font-semibold">Blk {entry.block.name}</span>
              <span className="block truncate text-caption text-foreground-muted">
                {entry.block.street}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
