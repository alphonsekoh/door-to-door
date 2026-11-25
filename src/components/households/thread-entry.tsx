"use client";

import { useId, useState } from "react";
import { InterestChip } from "@/components/ui/interest-chip";
import { VisitByline } from "@/components/visits/visit-byline";
import type { Visit } from "@/generated/types.gen";
import { formatDay } from "@/lib/history/dates";
import { clampDescription } from "@/lib/households/clamp";
import type { QueuedVisit } from "@/lib/sync/types";

/* Long enough to need opening, so the line stays near the picker. */
function Description({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { shown, clipped } = clampDescription(text);
  return (
    <>
      <p id={id} className="text-body whitespace-pre-line text-foreground-muted">
        {open ? text : shown}
      </p>
      {clipped ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen((now) => !now);
          }}
          className="min-h-11 text-body font-medium btn-text"
        >
          {open ? "Read less" : "Read more"}
        </button>
      ) : null}
    </>
  );
}

/* A visit in a unit's thread: how it went, when, who, and what was said. */
export function ThreadVisit({ visit }: { visit: Visit }) {
  return (
    <li className="text-caption">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <InterestChip level={visit.interestLevel} />
        <span className="text-foreground-muted">{formatDay(visit.createdAt)}</span>
      </div>
      <VisitByline visit={visit} />
      {visit.description === "" ? null : <Description text={visit.description} />}
    </li>
  );
}

/* One of this phone's own records, which the thread read has not got yet. */
export function ThreadQueued({ record }: { record: QueuedVisit }) {
  const { item } = record;
  return (
    <li className="text-caption">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <InterestChip level={item.interestLevel} />
        <span className="text-foreground-muted">{formatDay(item.clientCreatedAt)}</span>
      </div>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-foreground-muted">
        <span>You</span>
        {record.state === "synced" ? null : <span>Not sent yet</span>}
      </span>
      {item.description === undefined || item.description === "" ? null : (
        <Description text={item.description} />
      )}
    </li>
  );
}
