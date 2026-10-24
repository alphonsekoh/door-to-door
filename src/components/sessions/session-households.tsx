"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HouseholdPicker } from "@/components/sessions/household-picker";
import { ConfirmDialog, Sheet, SheetActions, SheetPresence } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";
import type {
  FollowUp,
  OutingSession,
  SessionBlock,
  SessionHousehold,
  SessionHouseholdList,
} from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { loadAllListed } from "@/lib/follow-ups/listed";
import { addBlocker, groupForPicking } from "@/lib/follow-ups/pick";
import { groupByBlock } from "@/lib/follow-ups/revisits";
import {
  REMOVE_BLOCKED,
  householdState,
  membersSee,
  removeBlocker,
  stateLabel,
} from "@/lib/follow-ups/session-households";

type State =
  { status: "loading" } | { status: "ready"; entries: SessionHousehold[] } | { status: "error" };

const failureText = (error: unknown, fallback: string) =>
  error instanceof ApiRequestError ? error.message : fallback;

/*
 * What a follow-up session goes back to: the households its admin picked,
 * where each stands, and the way to add or take one out. Its blocks follow
 * these, so the detail screen re-reads them after every change. An ended
 * session's picks are its record and do not change.
 */
export function SessionHouseholds({
  session,
  blocks,
  tick,
  onChanged,
  onCounted,
}: {
  session: OutingSession;
  /* The session's blocks as the detail screen read them, with this
     session's visits in each: a block holding some keeps its last pick. */
  blocks: readonly SessionBlock[];
  /* Bumped by the detail screen's poll, so the list re-reads with it. */
  tick: number;
  /* Blocks follow households, so the screen re-reads them too. */
  onChanged: () => Promise<void>;
  /* How many are on members' list, after each read: Start waits on it. */
  onCounted: (onList: number) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SessionHousehold | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const removingNow = useRef(false);
  const sessionId = session.id;
  const ended = session.status === "ended";

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const list = await apiFetch<SessionHouseholdList>(`/sessions/${sessionId}/households`);
      if (mine !== generation.current) return;
      setState({ status: "ready", entries: list.data });
      onCounted(list.data.filter((entry) => entry.onList).length);
    } catch {
      if (mine === generation.current) setState({ status: "error" });
    }
  }, [sessionId, onCounted]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, tick]);

  async function remove(entry: SessionHousehold): Promise<void> {
    if (removingNow.current) return;
    removingNow.current = true;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await apiFetch(`/sessions/${sessionId}/households/${entry.household.id}`, {
        method: "DELETE",
      });
      setNotice("Removed from this session. It is still on the follow-up list.");
    } catch (error) {
      setFailure(failureText(error, "Could not remove that household."));
    } finally {
      removingNow.current = false;
      setRemoving(null);
      setBusy(false);
    }
    await Promise.all([load(), onChanged()]);
  }

  const entries = state.status === "ready" ? state.entries : [];
  const seen = state.status === "ready" ? membersSee(entries, session.status) : null;

  return (
    <section aria-labelledby="session-households" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <h2 id="session-households" className="text-title font-semibold tabular-nums">
          Households to revisit
          {state.status === "ready" ? ` (${String(entries.length)})` : ""}
        </h2>
        {ended || state.status !== "ready" ? null : (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setFailure(null);
              setAdding(true);
            }}
            className="min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-body font-medium"
          >
            Add households
          </button>
        )}
      </div>
      {ended ? (
        <p className="text-caption text-foreground-muted">
          This session has ended. These are the households it was set up to revisit, as they stand
          today.
        </p>
      ) : null}
      {seen === null ? null : <p className="text-caption text-foreground-muted">{seen}</p>}

      {notice === null ? null : (
        <p role="status" className="text-body text-foreground-muted">
          {notice}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="notice-danger">
          {failure}
        </p>
      )}

      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading the households…</p>
      ) : state.status === "error" ? (
        <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body">Could not load this session&apos;s households.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
          >
            Try again
          </button>
        </div>
      ) : (
        groupByBlock(entries).map((group) => (
          <div key={group.block.id}>
            <p className="mb-1 text-caption font-semibold whitespace-nowrap text-foreground-muted">
              Blk {group.block.name}
            </p>
            <ul className="overflow-hidden rounded-xl border border-border bg-surface">
              {group.entries.map((entry) => (
                <HouseholdRow
                  key={entry.household.id}
                  entry={entry}
                  entries={entries}
                  session={session}
                  blocks={blocks}
                  onRemove={() => {
                    setRemoving(entry);
                  }}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      <SheetPresence>
        {adding ? (
          <AddHouseholdsSheet
            session={session}
            pickedIds={entries.map((entry) => entry.household.id)}
            onClose={() => {
              setAdding(false);
            }}
            onAdded={async (message) => {
              setAdding(false);
              setNotice(message);
              await Promise.all([load(), onChanged()]);
            }}
          />
        ) : null}
      </SheetPresence>

      <SheetPresence>
        {removing === null ? null : (
          <ConfirmDialog
            title={`Remove ${removing.household.unitNumber} from this session?`}
            detail="It stays on the follow-up list for a later session. Members will stop seeing it in this one."
            confirmLabel="Remove from session"
            cancelLabel="Keep it"
            busy={busy}
            onConfirm={() => void remove(removing)}
            onCancel={() => {
              setRemoving(null);
            }}
          />
        )}
      </SheetPresence>
    </section>
  );
}

function HouseholdRow({
  entry,
  entries,
  session,
  blocks,
  onRemove,
}: {
  entry: SessionHousehold;
  entries: readonly SessionHousehold[];
  session: OutingSession;
  blocks: readonly SessionBlock[];
  onRemove: () => void;
}) {
  const state = householdState(entry);
  const label = stateLabel(state, session.status);
  const blocker = removeBlocker(entry, entries, session.status, blocks);
  const door = `Blk ${entry.block.name} · ${entry.household.unitNumber}`;

  return (
    <li className="border-b border-border last:border-b-0">
      {/* At large text the state drops under the unit rather than squeeze it. */}
      <Link
        href={`/households/${entry.household.id}`}
        className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 press-row px-4 pt-2 pb-1"
      >
        <span className="min-w-0 flex-[1_1_12ch]">
          <span className="block text-body font-semibold tabular-nums">
            <UnitNumber value={entry.household.unitNumber} />
          </span>
          <span className="block truncate text-caption text-foreground-muted">
            {entry.household.name ?? "Name not known"}
          </span>
          {/* What the visit is for, as the picker said: owed notes come first.
              Off the follow-up list, what is left is no longer the reason. */}
          {state === "off_list"
            ? null
            : entry.notes.slice(0, 1).map((note) => (
                <span key={note.id} className="line-clamp-2 block text-body break-words">
                  {note.note}
                </span>
              ))}
        </span>
        {label === null ? null : (
          <span className="shrink-0 rounded-md border border-border-strong px-2 py-0.5 text-caption font-medium">
            {label}
          </span>
        )}
      </Link>
      {/* Beside the row, never inside its link. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pb-2">
        {state === "off_list" ? (
          <p className="text-caption text-foreground-muted">Members don&apos;t see it.</p>
        ) : null}
        {blocker === null ? (
          <button
            type="button"
            aria-label={`Remove ${door} from this session`}
            onClick={onRemove}
            className="ml-auto min-h-11 shrink-0 rounded-lg px-3 text-body font-medium text-danger"
          >
            Remove
          </button>
        ) : blocker === "ended" ? null : (
          <p className="text-caption text-foreground-muted">{REMOVE_BLOCKED[blocker]}</p>
        )}
      </div>
    </li>
  );
}

type Listed = { status: "loading" } | { status: "ready"; notes: FollowUp[] } | { status: "error" };

/*
 * Households on the follow-up list that this session has not picked, none
 * ticked: adding to a session already set up is a deliberate choice.
 */
function AddHouseholdsSheet({
  session,
  pickedIds,
  onClose,
  onAdded,
}: {
  session: OutingSession;
  pickedIds: readonly string[];
  onClose: () => void;
  onAdded: (message: string) => Promise<void>;
}) {
  const [listed, setListed] = useState<Listed>({ status: "loading" });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const notes = await loadAllListed();
      if (mine === generation.current) setListed({ status: "ready", notes });
    } catch {
      if (mine === generation.current) setListed({ status: "error" });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  const groups =
    listed.status === "ready"
      ? groupForPicking(listed.notes.filter((note) => !pickedIds.includes(note.householdId)))
      : [];
  const chosen = groups
    .flatMap((group) => group.households)
    .filter((household) => ticked.has(household.householdId))
    .map((household) => household.householdId);
  const blocker = addBlocker(chosen.length);

  async function add(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await apiFetch(`/sessions/${session.id}/households`, {
        method: "POST",
        body: JSON.stringify({ householdIds: chosen }),
      });
      await onAdded(
        session.status === "active"
          ? "Added. Members will see them the next time they refresh."
          : "Added.",
      );
    } catch (error) {
      setFailure(failureText(error, "Could not add those households."));
      // One may have left the list since it was read.
      void load();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const title = "Add households";

  return (
    <Sheet label={title} title={title} onClose={onClose}>
      <p className="mt-1 text-body text-foreground-muted">
        On the follow-up list, not in this session yet.
      </p>

      {failure === null ? null : (
        <p role="alert" className="mt-3 notice-danger">
          {failure}
        </p>
      )}

      <div className="mt-3">
        {listed.status === "loading" ? (
          <p className="text-body text-foreground-muted">Loading the follow-up list…</p>
        ) : listed.status === "error" ? (
          <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
            <p className="text-body">Could not load the follow-up list.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
            >
              Try again
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
            <p className="text-body">
              Every household on the follow-up list is already in this session.
            </p>
            <Link
              href="/admin/follow-ups"
              className="mt-1 inline-flex min-h-11 items-center text-body font-medium btn-text"
            >
              Open the follow-up list
            </Link>
          </div>
        ) : (
          <HouseholdPicker groups={groups} ticked={ticked} onChange={setTicked} />
        )}
      </div>

      <SheetActions>
        {blocker === null ? null : (
          <p
            id="add-households-note"
            className="mb-2 text-center text-caption text-foreground-muted"
          >
            {blocker}
          </p>
        )}
        <button
          type="button"
          disabled={busy || blocker !== null}
          aria-describedby={blocker === null ? undefined : "add-households-note"}
          onClick={() => void add()}
          className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
        >
          {busy
            ? "Adding…"
            : `Add ${String(chosen.length)} ${chosen.length === 1 ? "household" : "households"}`}
        </button>
      </SheetActions>
    </Sheet>
  );
}
