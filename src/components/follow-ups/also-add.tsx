"use client";

import { useState } from "react";
import type { OutingSession } from "@/generated/types.gen";
import { targetCaption } from "@/lib/follow-ups/target-session";
import { type TargetState, useTargetSession } from "@/lib/hooks/use-target-session";

export type AlsoAdd = {
  target: TargetState;
  checked: boolean;
  setChecked: (checked: boolean) => void;
  /* The session the door goes into as well, or null when none will. */
  chosen: OutingSession | null;
  /* Still asking which session that would be: the sheet's button waits. */
  looking: boolean;
};

/*
 * An admin adding a door to the follow-up list is offered the follow-up
 * session it is most likely meant for, ticked: the one running, else the
 * newest not started. A failed lookup offers nothing rather than blocking.
 */
export function useAlsoAdd(enabled: boolean): AlsoAdd {
  const target = useTargetSession(enabled);
  const [checked, setChecked] = useState(true);
  return {
    target,
    checked,
    setChecked,
    chosen: checked && target.status === "ready" ? target.target : null,
    looking: target.status === "loading",
  };
}

export function AlsoAddRow({ also }: { also: AlsoAdd }) {
  const { target } = also;
  if (target.status === "loading") {
    return (
      <p role="status" className="mt-3 text-caption text-foreground-muted">
        Looking for a follow-up session…
      </p>
    );
  }
  if (target.status === "error" || target.target === null) return null;
  const session = target.target;
  return (
    <label className="mt-3 flex min-h-11 cursor-pointer gap-3 rounded-lg border border-border-strong p-3">
      <input
        type="checkbox"
        checked={also.checked}
        onChange={(event) => {
          also.setChecked(event.target.checked);
        }}
        aria-labelledby="also-add-title"
        aria-describedby="also-add-caption"
        className="mt-1 size-5 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span id="also-add-title" className="block text-body font-medium break-words">
          Also add to {session.title}
        </span>
        <span id="also-add-caption" className="block text-caption text-foreground-muted">
          {targetCaption(session)}
        </span>
      </span>
    </label>
  );
}
