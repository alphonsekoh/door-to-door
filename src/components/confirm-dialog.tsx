"use client";

import { useRef } from "react";
import { Sheet } from "@/components/sheet";

/*
 * Confirmation for the things that take something away.
 *
 * Not window.confirm: it cannot be styled to reach the thumb, it blocks the
 * whole page, and it says "localhost:3000 says" above the question.
 *
 * Destructive by default, because nearly every use removes something, and a
 * confirm that looks like Save is one a thumb confirms without reading.
 */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  busy,
  tone = "destructive",
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  busy: boolean;
  tone?: "destructive" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  /* Focus lands on the way out, not on the button that takes something away. */
  const keep = useRef<HTMLButtonElement>(null);

  return (
    <Sheet
      label={title}
      role="alertdialog"
      layer="dialog"
      backdropLabel="Cancel"
      onClose={onCancel}
      initialFocus={keep}
      draggable={false}
      bodyClassName="pt-4"
    >
      <p className="text-title font-semibold">{title}</p>
      <p className="mt-1 text-body text-foreground-muted">{detail}</p>

      <div className="mt-4 space-y-2 pb-4">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`${tone === "destructive" ? "btn-danger" : "btn-primary"} min-h-14 w-full rounded-xl text-title font-semibold`}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button
          ref={keep}
          type="button"
          onClick={onCancel}
          className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          Keep as it is
        </button>
      </div>
    </Sheet>
  );
}
