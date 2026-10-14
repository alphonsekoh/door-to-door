"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminTeams } from "@/components/admin-teams";
import { BlockAttachSheet } from "@/components/block-attach-sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SessionActionButton } from "@/components/session-action-button";
import type { OutingSession, SessionBlock } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { availableActions, statusLabel } from "@/lib/sessions";

/* While an outing runs the numbers move, so they refresh on their own. Long
   enough not to drain the phone an admin is watching it on. */
const POLL_INTERVAL_MS = 30_000;

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

  const load = useCallback(async () => {
    try {
      const [session, blocks] = await Promise.all([
        apiFetch<OutingSession>(`/sessions/${sessionId}`),
        apiFetch<SessionBlock[]>(`/sessions/${sessionId}/blocks`),
      ]);
      setState({ status: "ready", session, blocks });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load this outing.",
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
     * block mid-outing needs to know members will not see it until they
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
        message: error instanceof Error ? error.message : "Could not remove that block.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
        <p className="text-body">{state.message}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 min-h-11 rounded-lg bg-primary px-4 text-body font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  const { session, blocks } = state;
  const recorded = blocks.reduce((sum, entry) => sum + entry.visitCount, 0);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-heading font-semibold">{session.title}</p>
        <p className="text-body text-foreground-muted">{statusLabel(session.status)}</p>
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
          className="block min-h-12 rounded-xl border border-border px-4 py-3 text-body font-medium"
        >
          See every record on this outing
        </Link>
      ) : null}

      {availableActions(session.status).map((spec) => (
        <SessionActionButton
          key={spec.action}
          sessionId={session.id}
          spec={spec}
          onDone={() => void load()}
        />
      ))}

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-title font-semibold">Blocks</h2>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setAttaching(true);
            }}
            className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-body font-medium"
          >
            Add blocks
          </button>
        </div>

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
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-semibold">Blk {entry.block.name}</p>
                    <p className="truncate text-caption text-foreground-muted">
                      {entry.block.street}
                    </p>
                    <p className="mt-1 text-caption text-foreground-muted tabular-nums">
                      {entry.householdCount} {entry.householdCount === 1 ? "unit" : "units"}
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

                  <button
                    type="button"
                    onClick={() => {
                      setDetaching(entry);
                    }}
                    className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-body font-medium"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AdminTeams sessionId={session.id} status={session.status} tick={tick} />

      {attaching ? (
        <BlockAttachSheet
          attachedIds={blocks.map((entry) => entry.block.id)}
          onAttach={attach}
          onClose={() => {
            setAttaching(false);
          }}
        />
      ) : null}

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
    </div>
  );
}
