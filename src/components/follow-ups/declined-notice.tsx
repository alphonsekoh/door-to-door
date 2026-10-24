"use client";

import { useEffect, useState } from "react";
import { FollowUpDoor } from "@/components/ui/unit-number";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { declinedSuggestions } from "@/lib/follow-ups/declined";
import { markDeclinedSeen, seenDeclined } from "@/lib/follow-ups/hints";
import { declinedByline } from "@/lib/history/follow-ups";

/*
 * Tells a member which of their suggestions an admin did not add, and why,
 * until they tap Got it on this phone. A bonus on the screen: a failed read
 * shows nothing rather than an error about something they did not ask for.
 */
export function DeclinedNotice({ userId }: { userId: string }) {
  const [declined, setDeclined] = useState<FollowUp[]>([]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      deleted: "true",
      authorId: userId,
      status: "suggested",
      limit: "20",
    });
    apiFetch<FollowUpList>(`/follow-ups?${params.toString()}`).then(
      (page) => {
        if (!cancelled) setDeclined(declinedSuggestions(page.data, Date.now(), seenDeclined()));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (declined.length === 0) return null;

  return (
    <section
      aria-labelledby="declined-heading"
      className="rounded-xl border border-border-strong bg-surface p-4"
    >
      <h2 id="declined-heading" className="text-body font-semibold">
        Not added to the follow-up list
      </h2>
      <ul className="mt-2 space-y-3">
        {declined.map((note) => (
          <li key={note.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <p className="text-body font-medium tabular-nums">
              <FollowUpDoor note={note} />
            </p>
            <p className="text-body break-words">{note.note}</p>
            <p className="text-caption text-foreground-muted">{declinedByline(note)}</p>
            {note.deleteReason === null ? null : (
              <p className="text-caption break-words">Reason: {note.deleteReason}</p>
            )}
            <button
              type="button"
              onClick={() => {
                markDeclinedSeen(note.id);
                setDeclined((current) => current.filter((other) => other.id !== note.id));
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
