"use client";

import { useCallback, useEffect, useState } from "react";
import { RecordVisitForm } from "@/components/record-visit-form";
import type { HouseholdList, HouseholdSummary } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

export function BlockScreen({ blockId }: { blockId: string }) {
  const [known, setKnown] = useState<HouseholdSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  /*
   * The units already recorded on this block. Held here so the form can show a
   * unit's history the moment its number is typed, without a lookup per
   * keystroke.
   */
  const load = useCallback(async () => {
    try {
      const households = await apiFetch<HouseholdList>(`/households?blockId=${blockId}&limit=100`);
      setKnown(households.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this block.");
    }
  }, [blockId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  return (
    <div className="space-y-5">
      {error === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body"
        >
          {error}
        </p>
      )}

      <RecordVisitForm blockId={blockId} known={known} onRecorded={() => void load()} />

      <p className="text-caption text-foreground-muted">
        {known.length === 0
          ? "No units recorded here yet."
          : `${String(known.length)} ${known.length === 1 ? "unit" : "units"} recorded here.`}
      </p>
    </div>
  );
}
