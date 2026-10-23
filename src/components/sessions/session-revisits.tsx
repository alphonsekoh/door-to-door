"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { UnitNumber } from "@/components/ui/unit-number";
import type { RevisitEntry, RevisitList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { revisitState } from "@/lib/follow-ups/revisits";
import {
  type UnattachedBlock,
  loadAllListed,
  unattachedListedBlocks,
} from "@/lib/follow-ups/listed";

type State =
  | { status: "loading" }
  | { status: "ready"; entries: RevisitEntry[]; unattached: UnattachedBlock[] }
  | { status: "error" };

const STATE_LABEL = { to_visit: null, visited: "Visited", done: "Done" } as const;

/*
 * What a follow-up session will go back to, for the admin preparing or
 * watching it. Its list is only what its blocks cover, so listed households
 * in other blocks are named with a way to add their block.
 */
export function SessionRevisits({
  sessionId,
  attachedIds,
  tick,
  onAttached,
}: {
  sessionId: string;
  attachedIds: readonly string[];
  /* Bumped by the detail screen's poll, so the panel re-reads with it. */
  tick: number;
  onAttached: () => Promise<void>;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [adding, setAdding] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);
  const attachedKey = attachedIds.join(",");

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const [list, listed] = await Promise.all([
        apiFetch<RevisitList>(`/sessions/${sessionId}/revisits`),
        loadAllListed(),
      ]);
      if (mine !== generation.current) return;
      setState({
        status: "ready",
        entries: list.data,
        unattached: unattachedListedBlocks(listed, attachedKey.split(",")),
      });
    } catch {
      if (mine === generation.current) setState({ status: "error" });
    }
  }, [sessionId, attachedKey]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, tick]);

  async function attach(block: UnattachedBlock): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setAdding(block.blockId);
    setFailure(null);
    try {
      await apiFetch(`/sessions/${sessionId}/blocks`, {
        method: "POST",
        body: JSON.stringify({ blockIds: [block.blockId] }),
      });
      await onAttached();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not add that block.");
    } finally {
      sending.current = false;
      setAdding(null);
    }
  }

  return (
    <section aria-labelledby="session-revisits" className="space-y-2">
      <h2 id="session-revisits" className="text-title font-semibold tabular-nums">
        Households to revisit
        {state.status === "ready" ? ` (${String(state.entries.length)})` : ""}
      </h2>

      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading the list…</p>
      ) : state.status === "error" ? (
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
      ) : (
        <>
          {state.entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
              No households on the list in these blocks yet.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-border bg-surface">
              {state.entries.map((entry) => {
                const label = STATE_LABEL[revisitState(entry)];
                return (
                  <li key={entry.household.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={`/households/${entry.household.id}`}
                      className="flex min-h-11 flex-wrap items-center gap-x-3 press-row px-4 py-2"
                    >
                      <span className="min-w-0 flex-[1_1_12ch]">
                        <span className="block text-body font-semibold tabular-nums">
                          Blk {entry.block.name} · <UnitNumber value={entry.household.unitNumber} />
                        </span>
                        <span className="block truncate text-caption text-foreground-muted">
                          {entry.household.name ?? "Name not known"}
                        </span>
                      </span>
                      {label === null ? null : (
                        <span className="shrink-0 rounded-md border border-border-strong px-2 py-0.5 text-caption font-medium">
                          {label}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {failure === null ? null : (
            <p role="alert" className="notice-danger">
              {failure}
            </p>
          )}

          {state.unattached.map((block) => (
            <div
              key={block.blockId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 notice-info"
            >
              <p className="min-w-0 flex-[1_1_12ch]">
                <span className="whitespace-nowrap">Blk {block.blockName}</span> has{" "}
                {block.households === 1 ? "1 household" : `${String(block.households)} households`}{" "}
                on the follow-up list.
              </p>
              <button
                type="button"
                disabled={adding !== null}
                onClick={() => void attach(block)}
                className="min-h-11 shrink-0 btn-secondary rounded-lg bg-background px-3 text-body font-medium"
              >
                {adding === block.blockId ? "Adding…" : `Add Blk ${block.blockName}`}
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
