"use client";

import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";
import type { ActiveSession, HouseholdSummary, RevisitEntry } from "@/generated/types.gen";
import {
  type LocalCopy,
  type LocalMember,
  noteBlock,
  noteOuting,
  noteRevisits,
} from "@/lib/offline/local-copy";
import { updateLocalCopy } from "@/lib/offline/local-copy-store";
import { useRole } from "@/lib/hooks/use-role";

export type LocalCopyWriter = {
  noteOuting: (active: ActiveSession | null) => void;
  noteBlock: (active: ActiveSession, blockId: string, households: HouseholdSummary[]) => void;
  noteRevisits: (active: ActiveSession, revisits: RevisitEntry[]) => void;
};

/*
 * Fills the offline shell's copy from what the online screens fetched. Only
 * for a member the session names: until it has loaded nothing is written, and
 * the callbacks change once it has, so a screen's effect writes again then.
 * Fire and forget: a copy that cannot be written costs the shell, never the
 * screen that is working.
 */
export function useLocalCopyWriter(): LocalCopyWriter {
  const { userId } = useRole();
  const { data } = useSession();
  const name = data?.user.name ?? data?.user.email ?? null;

  const write = useCallback(
    (change: (copy: LocalCopy | null, member: LocalMember, now: number) => LocalCopy | null) => {
      if (userId === undefined || name === null) return;
      const member = { id: userId, name };
      updateLocalCopy((copy) => change(copy, member, Date.now())).catch(() => undefined);
    },
    [userId, name],
  );

  return useMemo(
    () => ({
      noteOuting: (active) => {
        write((copy, member, now) => noteOuting(copy, member, active, now));
      },
      noteBlock: (active, blockId, households) => {
        write((copy, member, now) => noteBlock(copy, member, active, blockId, households, now));
      },
      noteRevisits: (active, revisits) => {
        write((copy, member, now) => noteRevisits(copy, member, active, revisits, now));
      },
    }),
    [write],
  );
}
