"use client";

import Link from "next/link";
import { useState } from "react";
import { OverdueBadge, followUpTone } from "@/components/follow-up-item";
import type { FollowUp } from "@/generated/types.gen";
import { formatDay, isOverdue, sortOutstanding, unitLabel } from "@/lib/follow-ups";

/*
 * The notes this member left themselves, at the top of their history.
 *
 * A promise made at a door is the one thing here that has a deadline, so it
 * sits above the record of what has already been done, soonest due first.
 */
export function OutstandingFollowUps({ notes }: { notes: FollowUp[] }) {
  const [now] = useState(() => new Date());
  const sorted = sortOutstanding(notes);

  if (sorted.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Your outstanding follow-ups"
      className="rounded-xl border border-interest-medium/50 bg-interest-medium/10 p-4"
    >
      <h2 className="text-caption font-semibold tracking-wide uppercase">
        {sorted.length === 1
          ? "1 follow-up you still owe"
          : `${String(sorted.length)} follow-ups you still owe`}
      </h2>

      <ul className="mt-2 space-y-2">
        {sorted.map((note) => (
          <li key={note.id}>
            <Link
              href={`/households/${note.householdId}`}
              className={`block rounded-lg border p-3 ${followUpTone(note, now)}`}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-body font-semibold tabular-nums">{unitLabel(note)}</span>
                {isOverdue(note, now) ? <OverdueBadge /> : null}
              </span>
              <span className="block text-body break-words">{note.note}</span>
              {note.dueDate === null ? null : (
                <span className="block text-caption text-foreground-muted">
                  Due {formatDay(note.dueDate)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
