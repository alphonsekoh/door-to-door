"use client";

import { useEffect, useState } from "react";
import { FollowUpDoor } from "@/components/ui/unit-number";
import {
  NOTICE_FIRST,
  type RemovedNote,
  authorNoticeLine,
  loadRemovalsForAuthor,
  removedForAuthor,
} from "@/lib/follow-ups/declined";
import { markAllDeclinedSeen, markDeclinedSeen, seenDeclined } from "@/lib/follow-ups/hints";

/*
 * Tells a member which of their notes someone else took away, a suggestion
 * declined or a note removed from the follow-up list, and why, until they
 * tap Got it on this phone. A bonus on the screen: a failed read shows
 * nothing rather than an error about something they did not ask for. The
 * newest few come first, so a backlog never buries the Follow-ups list
 * below it, and one tap clears them all.
 */
export function DeclinedNotice({ userId }: { userId: string }) {
  const [removed, setRemoved] = useState<RemovedNote[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    loadRemovalsForAuthor(userId, Date.now()).then(
      (notes) => {
        setRemoved(removedForAuthor(notes, seenDeclined()));
      },
      () => undefined,
    );
  }, [userId]);

  if (removed.length === 0) return null;

  const shown = all ? removed : removed.slice(0, NOTICE_FIRST);

  return (
    <section
      aria-labelledby="declined-heading"
      className="rounded-xl border border-border-strong bg-surface p-4"
    >
      <h2 id="declined-heading" className="text-body font-semibold">
        Not on the follow-up list
      </h2>
      {/* Above the notes, as a notification stack keeps Show all and Clear:
          under three notes they sat below the bottom nav on arrival, and how
          many more there were went unseen. */}
      {removed.length < 2 ? null : (
        <div className="flex flex-wrap gap-x-5">
          {removed.length > NOTICE_FIRST ? (
            <button
              type="button"
              aria-expanded={all}
              aria-controls="declined-list"
              onClick={() => {
                setAll((open) => !open);
              }}
              className="min-h-11 font-medium btn-text tabular-nums"
            >
              {all ? "Show fewer" : `Show all (${String(removed.length)})`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              markAllDeclinedSeen(removed.map((note) => note.id));
              setRemoved([]);
            }}
            className="min-h-11 font-medium btn-text"
          >
            Got it to all
          </button>
        </div>
      )}
      <ul
        id="declined-list"
        className={`space-y-3 ${removed.length < 2 ? "mt-2" : "mt-1 border-t border-border pt-3"}`}
      >
        {shown.map((note) => (
          <li key={note.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <p className="text-body font-medium tabular-nums">
              <FollowUpDoor note={note} />
            </p>
            <p className="text-body break-words">{note.note}</p>
            <p className="text-caption break-words text-foreground-muted">
              {authorNoticeLine(note)}
            </p>
            <button
              type="button"
              onClick={() => {
                markDeclinedSeen(note.id);
                setRemoved((current) => current.filter((other) => other.id !== note.id));
              }}
              className="mt-1 min-h-11 min-w-11 font-medium btn-text"
            >
              Got it
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
