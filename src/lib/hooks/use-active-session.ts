"use client";

import { useEffect, useState } from "react";
import type { ActiveSession } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { knownSessionKind } from "@/lib/session/known-kind";

/*
 * The running session, asked once, for screens whose controls depend on it
 * (a member resolves a listed note only in its follow-up session). Null while
 * asking, when nothing runs, and when it cannot be read: the server decides
 * every change anyway, so not knowing only hides what it would refuse.
 */
export function useActiveSession(): ActiveSession | null {
  const [active, setActive] = useState<ActiveSession | null>(null);
  useEffect(() => {
    apiFetch<ActiveSession>("/sessions/active").then(
      (answer) => {
        knownSessionKind.note(answer.session.kind);
        setActive(answer);
      },
      () => undefined,
    );
  }, []);
  return active;
}
