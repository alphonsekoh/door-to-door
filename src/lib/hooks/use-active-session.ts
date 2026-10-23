"use client";

import { useEffect, useState } from "react";
import type { ActiveSession } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * The running session, asked once, for screens whose controls depend on it
 * (a member resolves a listed note only in its follow-up session). Null while
 * asking, when nothing runs, and when it cannot be read: the server decides
 * every change anyway, so not knowing only hides what it would refuse.
 */
export function useActiveSession(): ActiveSession | null {
  const [active, setActive] = useState<ActiveSession | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<ActiveSession>("/sessions/active").then(
      (answer) => {
        if (!cancelled) setActive(answer);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return active;
}
