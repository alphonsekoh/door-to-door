"use client";

import { useRef, type RefObject } from "react";
import { Sheet } from "@/components/ui/sheet";

/*
 * Why a Save was refused, for a blank unit number or note, or for whatever
 * the server would not accept (D-119-13). Every reason refused at that moment
 * is listed, and the one way out, OK, sends focus to the first field at fault
 * (D-119-15). The line beside Save and the field's own error stay, so nothing
 * that was announced before is lost.
 *
 * A dialog-layer alert, laid out as ConfirmDialog is, so it sits above the
 * sheet it may be raised from and the docked Save (D-119-14).
 */
export function NotSavedDialog({
  lead,
  reasons,
  returnFocus,
  onDismiss,
}: {
  /* "This visit could not be saved because:" */
  lead: string;
  reasons: readonly string[];
  returnFocus: RefObject<HTMLElement | null> | undefined;
  onDismiss: () => void;
}) {
  const ok = useRef<HTMLButtonElement>(null);

  return (
    <Sheet
      label="Not saved"
      role="alertdialog"
      layer="dialog"
      backdropLabel="OK"
      onClose={onDismiss}
      initialFocus={ok}
      returnFocus={returnFocus}
      draggable={false}
      bodyClassName="pt-4"
    >
      <p className="text-title font-semibold">Not saved</p>
      <p className="mt-1 text-body text-foreground-muted">{lead}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-body">
        {reasons.map((reason) => (
          <li key={reason} className="break-words">
            {reason}
          </li>
        ))}
      </ul>

      <div className="mt-4 pb-4">
        <button
          ref={ok}
          type="button"
          onClick={onDismiss}
          className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
        >
          OK
        </button>
      </div>
    </Sheet>
  );
}
