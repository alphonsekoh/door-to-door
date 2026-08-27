"use client";

import Link from "next/link";
import type { FollowUp } from "@/generated/types.gen";

/*
 * The notes this member left themselves, at the top of their history.
 *
 * A promise made at a door is the one thing here that has a deadline, so it
 * sits above the record of what has already been done.
 *
 * The payload carries only the household's id, not its unit number, so each
 * note links through rather than naming the door. Widening the FollowUp schema
 * belongs with the follow-ups UI in #35, not here.
 */
export function OutstandingFollowUps({ notes }: { notes: FollowUp[] }) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Your outstanding follow-ups"
      className="rounded-xl border border-interest-medium/50 bg-interest-medium/10 p-4"
    >
      <h2 className="text-caption font-semibold tracking-wide uppercase">
        {notes.length === 1
          ? "1 follow-up you still owe"
          : `${String(notes.length)} follow-ups you still owe`}
      </h2>

      <ul className="mt-2 space-y-2">
        {notes.map((note) => (
          <li key={note.id}>
            <Link href={`/households/${note.householdId}`} className="block py-1">
              <span className="block text-body">{note.note}</span>
              {note.dueDate === null ? null : (
                <span className="block text-caption text-foreground-muted">
                  Due {new Date(note.dueDate).toLocaleDateString()}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
