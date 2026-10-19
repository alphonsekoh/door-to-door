"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OverdueBadge } from "@/components/follow-up-item";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { startOfToday, unitLabel } from "@/lib/follow-ups";

const SHOWN = 5;

type State =
  | { status: "loading" }
  | { status: "ready"; notes: FollowUp[]; total: number }
  | { status: "error" };

/*
 * Promises past their day, for the admin landing page. Uses the ordinary list
 * with `dueBefore` set to the start of today, so a note due today is not
 * counted, and takes the count from the page total rather than a new endpoint.
 * It is a bonus on this screen: a failed load is noted, never blocking.
 */
export function OverdueFollowUps() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const before = encodeURIComponent(startOfToday(new Date()));
    apiFetch<FollowUpList>(
      `/follow-ups?outstanding=true&dueBefore=${before}&limit=${String(SHOWN)}`,
    ).then(
      (page) => {
        setState({ status: "ready", notes: page.data, total: page.pagination.total });
      },
      () => {
        setState({ status: "error" });
      },
    );
  }, []);

  if (state.status === "loading") return null;

  if (state.status === "error") {
    return (
      <p className="text-caption text-foreground-muted">Could not check for overdue follow-ups.</p>
    );
  }

  if (state.total === 0) return null;

  return (
    <section
      aria-label="Overdue follow-ups"
      className="rounded-xl border border-danger/60 bg-danger/10 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold">
          {state.total === 1 ? "1 overdue follow-up" : `${String(state.total)} overdue follow-ups`}
        </h2>
        <OverdueBadge />
      </div>
      <ul className="mt-2 space-y-1">
        {state.notes.map((note) => (
          <li key={note.id}>
            <Link href={`/households/${note.householdId}`} className="block min-h-11 py-1">
              <span className="block text-body font-medium tabular-nums">{unitLabel(note)}</span>
              <span className="block text-caption break-words text-foreground-muted">
                {note.note}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/follow-ups"
        className="mt-2 inline-flex min-h-11 items-center text-body font-medium btn-text"
      >
        See all
      </Link>
    </section>
  );
}
