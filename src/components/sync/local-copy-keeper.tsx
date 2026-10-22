"use client";

import { useEffect } from "react";
import { updateLocalCopy } from "@/lib/offline/local-copy-store";
import { useRole } from "@/lib/hooks/use-role";

/*
 * A signed-in page that sees someone other than the copy's member forgets
 * the copy. Sign-in and sign-out clear it too, but not every change of member
 * passes through them: Google sign-in returns by redirect, and a session can
 * simply expire. Checked and cleared in one transaction, so a copy this
 * member's screens write meanwhile is never the one removed. Never the queue
 * (D-33-1).
 */
export function LocalCopyKeeper() {
  const { userId } = useRole();
  useEffect(() => {
    if (userId === undefined) return;
    updateLocalCopy((copy) => (copy !== null && copy.member.id !== userId ? null : copy)).catch(
      () => undefined,
    );
  }, [userId]);
  return null;
}
