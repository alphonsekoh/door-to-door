"use client";

import { useEffect, useState } from "react";
import type { OutingSession } from "@/generated/types.gen";
import { loadTarget } from "@/lib/follow-ups/target-session";

export type TargetState =
  { status: "loading" } | { status: "ready"; target: OutingSession | null } | { status: "error" };

const NONE: TargetState = { status: "ready", target: null };

/*
 * The follow-up session a door added to the list may also go into, asked
 * once when an admin opens a sheet that adds one. Off (a member, or an
 * edit), it is simply none.
 */
export function useTargetSession(enabled: boolean): TargetState {
  const [state, setState] = useState<TargetState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    loadTarget().then(
      (target) => {
        setState({ status: "ready", target });
      },
      () => {
        setState({ status: "error" });
      },
    );
  }, [enabled]);
  return enabled ? state : NONE;
}
