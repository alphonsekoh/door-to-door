"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminTeams } from "@/components/admin/admin-teams";
import { BlockAttachSheet } from "@/components/blocks/block-attach-sheet";
import { PageHeader } from "@/components/ui/page-header";
import { KindBadge } from "@/components/sessions/kind-badge";
import { SessionActionButton } from "@/components/sessions/session-action-button";
import { SessionHouseholds } from "@/components/sessions/session-households";
import type { OutingSession, SessionBlock } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { startBlocker } from "@/lib/follow-ups/session-households";
import { sessionAction, statusLabel } from "@/lib/session/sessions";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";

/* While a session runs the numbers move, so they refresh on their own. Long
   enough not to drain the phone an admin is watching it on. */
const POLL_INTERVAL_MS = 30_000;

const BACK = { href: "/admin/sessions", label: "Sessions" };

type State =
  | { status: "loading" }
  | { status: "ready"; session: OutingSession; blocks: SessionBlock[] }
  | { status: "error"; message: string };

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attaching, setAttaching] = useState(false);
  const [detaching, setDetaching] = useState<SessionBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /* Bumped by the poll so the team panel re-reads on the same beat. */
  const [tick, setTick] = useState(0);
  /* A follow-up session's households on members' list, once read. */
  const [onList, setOnList] = useState<number | null>(null);
  /* Every read of the session drawn, counted with what it read: the action
     button tells by it that a read since its refusal has landed. */
  const [reads, setReads] = useState(0);
  /* The poll, a refusal's re-read and each change's reload can cross; only
     the newest answer may land (D-28-7). An older one drew "Running now"
     over a session read since as ended. */
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const [session, blocks] = await Promise.all([
        apiFetch<OutingSession>(`/sessions/${sessionId}`),
        apiFetch<SessionBlock[]>(`/sessions/${sessionId}/blocks`),
      ]);
      if (mine !== generation.current) return;
      setState({ status: "ready", session, blocks });
      setReads((count) => count + 1);
    } catch (error) {
      if (mine !== generation.current) return;
      setState({
        status: "error",
        message: failureLine(error, "Could not load this session."),
      });
    }
  }, [sessionId]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      void load();
      setTick((current) => current + 1);
    }, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);

  async function attach(blockIds: string[]): Promise<void> {
    await apiFetch(`/sessions/${sessionId}/blocks`, {
      method: "POST",
      body: JSON.stringify({ blockIds }),
    });
    setAttaching(false);
    /*
     * Said out loud because it is the contingency path: an admin adding a
     * block mid-session needs to know members will not see it until they
     * refresh, so they can tell them.
     */
    setNotice(
      state.status === "ready" && state.session.status === "active"
        ? "Added. Members will see it the next time they refresh."
        : "Added.",
    );
    await load();
  }

  async function detach(block: SessionBlock): Promise<void> {
    setBusy(true);
    try {
      await apiFetch(`/sessions/${sessionId}/blocks/${block.block.id}`, { method: "DELETE" });
      setDetaching(null);
      await load();
    } catch (error) {
      setState({
        status: "error",
        message: failureLine(error, "Could not remove that block."),
      });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Session" back={BACK} />
        <p className="text-body text-foreground-muted">Loading…</p>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <PageHeader title="Session" back={BACK} />
        <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  const { session, blocks } = state;
  const recorded = blocks.reduce((sum, entry) => sum + entry.visitCount, 0);
  /* A follow-up session's blocks follow its households: read-only here. */
  const byHand = session.kind === "regular";
  const action = sessionAction(session.status);

  return (
    <div className="space-y-5">
      {/* The session's own name is the heading, not the word "Session". */}
      <div>
        <PageHeader title={session.title} subtitle={statusLabel(session.status)} back={BACK} />
        {session.kind === "follow_up" ? (
          <p className="-mt-3 flex flex-wrap items-center gap-2 text-caption text-foreground-muted">
            <KindBadge kind={session.kind} />
            Members can record any unit in its blocks; a visit at a household on its list marks its
            follow-up done.
          </p>
        ) : null}
      </div>

      {session.status === "ended" ? (
        <div className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body font-medium">
            {recorded} {recorded === 1 ? "visit" : "visits"} recorded across {blocks.length}{" "}
            {blocks.length === 1 ? "block" : "blocks"}.
          </p>
          <p className="mt-1 text-body text-foreground-muted">
            Reopen it if anyone still needs to record or amend.
          </p>
        </div>
      ) : null}

      {session.status === "active" ? (
        <Link
          href="/admin/records"
          className="block min-h-12 btn-secondary rounded-xl px-4 py-3 text-body font-medium"
        >
          See every record in this session
        </Link>
      ) : null}

      {/* Keyed by nothing that changes with the status, as on the list: a
          refused End read back as ended turns the same button into Reopen.
          Only the session and its blocks are read again, not the panels'
          tick: the households read could disable a follow-up Start just
          given focus back. */}
      <SessionActionButton
        sessionId={session.id}
        spec={action}
        read={reads}
        blocked={
          action.action === "start" && session.kind === "follow_up" ? startBlocker(onList) : null
        }
        onDone={() => void load()}
        onStale={() => void load()}
      />

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
          <h2 className="text-title font-semibold">Blocks</h2>
          {byHand ? (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setAttaching(true);
              }}
              className="min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-body font-medium"
            >
              Add blocks
            </button>
          ) : null}
        </div>
        {byHand ? null : (
          <p className="mb-2 text-caption text-foreground-muted">
            Blocks follow the households in this session.
          </p>
        )}

        {notice === null ? null : (
          <p role="status" className="mb-2 text-body text-foreground-muted">
            {notice}
          </p>
        )}

        {blocks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
            No blocks attached yet. Members cannot record anywhere until there is at least one.
          </p>
        ) : (
          <ul className="space-y-2">
            {blocks.map((entry) => (
              <li
                key={entry.block.id}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                {/* At large text Remove drops under the block rather than
                    squeeze its street and counts to a few letters. */}
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-[1_1_12ch]">
                    <p className="text-body font-semibold whitespace-nowrap">
                      Blk {entry.block.name}
                    </p>
                    <p className="truncate text-caption text-foreground-muted">
                      {entry.block.street}
                    </p>
                    {/* Units visited in this session, as the home card counts
                        them: "units" alone read as the size of the block. */}
                    <p className="mt-1 text-caption text-foreground-muted tabular-nums">
                      {entry.householdCount} visited
                      {entry.visitCount > entry.householdCount
                        ? `, ${String(entry.visitCount)} visits`
                        : ""}
                    </p>
                    {entry.activeMembers.length > 0 ? (
                      <p className="mt-1 truncate text-caption text-foreground-muted">
                        {entry.activeMembers.map((member) => member.name ?? "Someone").join(", ")}{" "}
                        here now
                      </p>
                    ) : null}
                  </div>

                  {byHand ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDetaching(entry);
                      }}
                      className="min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-body font-medium"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {session.kind === "follow_up" ? (
        <SessionHouseholds
          session={session}
          blocks={blocks}
          tick={tick}
          onChanged={load}
          onCounted={setOnList}
        />
      ) : null}

      <AdminTeams sessionId={session.id} status={session.status} tick={tick} />

      <SheetPresence>
        {attaching ? (
          <BlockAttachSheet
            attachedIds={blocks.map((entry) => entry.block.id)}
            onAttach={attach}
            onClose={() => {
              setAttaching(false);
            }}
          />
        ) : null}
      </SheetPresence>

      <SheetPresence>
        {detaching === null ? null : (
          <ConfirmDialog
            title={`Remove Blk ${detaching.block.name}?`}
            detail={
              detaching.visitCount > 0
                ? `${String(detaching.visitCount)} visits were recorded here. They are kept, but members will not be able to record here again until it is re-attached.`
                : "Members will no longer see it in the block picker."
            }
            confirmLabel="Remove the block"
            busy={busy}
            onConfirm={() => void detach(detaching)}
            onCancel={() => {
              setDetaching(null);
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}
