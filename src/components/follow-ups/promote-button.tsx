"use client";

import { useState } from "react";
import { PromoteSheet } from "@/components/follow-ups/promote-sheet";
import { SheetPresence } from "@/components/ui/sheet";
import type { FollowUp } from "@/generated/types.gen";
import { ADD_TO_LIST } from "@/lib/follow-ups/rights";
import { useOnline } from "@/lib/hooks/use-online";

/*
 * An admin listing a household a member has already suggested: the
 * suggestion goes on the list, in its author's words, rather than a second
 * note beside it that would leave the suggestion waiting and, once
 * dismissed, tell its author it was declined. It opens the sheet that shows
 * the suggestion first.
 */
export function PromoteButton({
  suggestion,
  onPromoted,
  className,
}: {
  suggestion: FollowUp;
  onPromoted: (message: string) => void;
  className: string;
}) {
  const online = useOnline();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={!online}
        onClick={() => {
          setOpen(true);
        }}
        className={className}
      >
        {ADD_TO_LIST}
      </button>
      <SheetPresence>
        {open ? (
          <PromoteSheet
            suggestion={suggestion}
            onClose={() => {
              setOpen(false);
            }}
            onPromoted={(message) => {
              setOpen(false);
              onPromoted(message);
            }}
          />
        ) : null}
      </SheetPresence>
    </>
  );
}
