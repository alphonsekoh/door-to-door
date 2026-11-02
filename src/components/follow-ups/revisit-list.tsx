"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OverdueBadge } from "@/components/follow-ups/follow-up-item";
import { RevisitPill } from "@/components/follow-ups/revisit-pill";
import { useLocalCopyWriter } from "@/components/sync/local-copy-writer";
import { InterestChip } from "@/components/ui/interest-chip";
import { UnitNumber } from "@/components/ui/unit-number";
import type { ActiveSession, RevisitEntry, RevisitList as List } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { groupByBlock, progress, revisitState } from "@/lib/follow-ups/revisits";
import { followUpRights, waitingCaption } from "@/lib/follow-ups/rights";
import { describeFollowUpFailure, isOverdue } from "@/lib/history/follow-ups";
import { formatDay } from "@/lib/history/dates";
import { useOnline } from "@/lib/hooks/use-online";
import { useRole } from "@/lib/hooks/use-role";

type State =
  { status: "loading" } | { status: "ready"; entries: RevisitEntry[] } | { status: "error" };

/*
 * A follow-up session's households, grouped by block, which drive the
 * session screen: a member taps one to record there with its unit filled in
 * (saving the visit marks it done), marks one done that needed no visit,
 * and reopens one marked done too soon. A failed read stays in here, so the
 * team card and the rest of the screen still work.
 */
export function RevisitList({
  active,
  tick,
  isAdmin,
}: {
  active: ActiveSession;
  /* Bumped by the screen's poll and Refresh, so the list re-reads with them. */
  tick: number;
  isAdmin: boolean;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const { noteRevisits } = useLocalCopyWriter();
  const sessionId = active.session.id;
  /* A poll and a Refresh can overlap; only the newest answer may land. */
  const generation = useRef(0);
  /* The newest session answer, for the offline copy, without re-reading
     the list every time the screen's poll hands over a new object. */
  const latest = useRef(active);
  useEffect(() => {
    latest.current = active;
  }, [active]);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const list = await apiFetch<List>(`/sessions/${sessionId}/revisits`);
      if (mine !== generation.current) return;
      setState({ status: "ready", entries: list.data });
      noteRevisits(latest.current, list.data);
    } catch {
      if (mine === generation.current) setState({ status: "error" });
    }
  }, [sessionId, noteRevisits]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, tick]);

  return (
    <section aria-labelledby="revisits-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="revisits-heading" className="text-title font-semibold">
          Households to revisit
        </h2>
        {state.status === "ready" && state.entries.length > 0 ? (
          <p className="text-caption text-foreground-muted tabular-nums">
            {progress(state.entries)}
          </p>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading the list…</p>
      ) : state.status === "error" ? (
        <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body">Could not load the follow-up list. Check your signal.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
          >
            Try again
          </button>
        </div>
      ) : state.entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
          <p className="text-body font-medium">No households on the list yet.</p>
          {/* Being on the follow-up list is not enough: an admin adds a
              household to this session, on the session's own page. */}
          {isAdmin ? (
            <Link
              href={`/admin/sessions/${sessionId}`}
              className="mt-1 inline-flex min-h-11 items-center text-body font-medium btn-text"
            >
              Add households to this session
            </Link>
          ) : (
            <p className="mt-1 text-body text-foreground-muted">
              An admin adds households to this session. Tap Refresh to check again.
            </p>
          )}
        </div>
      ) : (
        groupByBlock(state.entries).map((group) => (
          <div key={group.block.id} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <p className="min-w-0 flex-[1_1_12ch] text-body font-semibold">
                <span className="whitespace-nowrap">Blk {group.block.name}</span>
                <span className="font-normal text-foreground-muted"> · {group.block.street}</span>
              </p>
              <Link
                href={`/blocks/${group.block.id}`}
                className="inline-flex min-h-11 items-center text-body font-medium btn-text"
              >
                Open block
              </Link>
            </div>
            <ul className="overflow-hidden rounded-xl border border-border bg-surface">
              {group.entries.map((entry) => (
                <RevisitRow
                  key={entry.household.id}
                  entry={entry}
                  active={active}
                  onChanged={() => void load()}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function RevisitRow({
  entry,
  active,
  onChanged,
}: {
  entry: RevisitEntry;
  active: ActiveSession;
  onChanged: () => void;
}) {
  const online = useOnline();
  const { userId, isAdmin } = useRole();
  const [now] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);
  const state = revisitState(entry);
  const owed = entry.notes.filter((note) => note.doneAt === null);
  const first = owed[0] ?? entry.notes[0];
  const { household, block } = entry;
  /* A Done row reopens every note it counts, so only where the viewer may
     reopen each; a suggestion waiting at the door is said instead. */
  const rights = entry.notes.map((note) => followUpRights(note, { userId, isAdmin }, active));
  const canReopen = state === "done" && rights.every((right) => right.canResolve);
  const waiting =
    state === "done"
      ? (rights.find((right) => right.waitingSuggestion !== null)?.waitingSuggestion ?? null)
      : null;

  /* Every note that put the household on the list, usually one, closed or
     reopened together. The list is read again whatever came of it: with one
     note changed and the next refused, or a reply lost, only the server
     knows what is still owed. */
  async function change(done: boolean): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      for (const note of done ? owed : entry.notes) {
        await apiFetch(`/follow-ups/${note.id}`, {
          method: "PATCH",
          body: JSON.stringify({ done }),
        });
      }
    } catch (error) {
      setFailure(describeFollowUpFailure(error, done ? "save" : "reopen"));
    } finally {
      sending.current = false;
      setBusy(false);
      onChanged();
    }
  }

  return (
    <li className="border-b border-border last:border-b-0">
      {/* The row opens the block with this unit filled in; Mark done or
          Reopen sits beside it, never inside the link. */}
      <Link
        href={`/blocks/${block.id}?unit=${encodeURIComponent(household.unitNumber)}`}
        className="block press-row px-4 py-3"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-[1_1_12ch] text-body font-semibold tabular-nums">
            <UnitNumber value={household.unitNumber} />
          </span>
          {entry.latestVisit === null ? null : (
            <InterestChip level={entry.latestVisit.interestLevel} />
          )}
          <RevisitPill state={state} />
        </span>
        <span className="block text-caption text-foreground-muted">
          {household.name ?? "Name not known"}
        </span>
        {first === undefined ? null : (
          <span className="mt-1 line-clamp-2 block text-body break-words">{first.note}</span>
        )}
        {first?.dueDate == null ? null : isOverdue(first, now) ? (
          <span className="mt-1 inline-block">
            <OverdueBadge />
          </span>
        ) : (
          <span className="block text-caption text-foreground-muted">
            Due {formatDay(first.dueDate)}
          </span>
        )}
      </Link>
      {state === "done" && !canReopen && waiting === null && failure === null ? null : (
        <div className="px-4 pb-3">
          {failure === null ? null : (
            <p role="alert" className="mb-2 notice-danger">
              {failure}
            </p>
          )}
          {state !== "done" || canReopen ? (
            <button
              type="button"
              disabled={busy || !online}
              onClick={() => void change(state !== "done")}
              className="min-h-11 btn-secondary rounded-lg px-4 text-body font-medium"
            >
              {busy ? (
                "Saving…"
              ) : (
                <>
                  {state === "done" ? "Reopen" : "Mark done"}
                  {/* Each row's button names its door to a screen reader. */}
                  <span className="sr-only">, {household.unitNumber}</span>
                </>
              )}
            </button>
          ) : null}
          {waiting === null ? null : (
            <p className="mt-1 text-caption break-words text-foreground-muted">
              {waitingCaption(waiting, isAdmin)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
