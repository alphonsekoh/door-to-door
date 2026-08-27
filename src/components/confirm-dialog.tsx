"use client";

/*
 * Confirmation for the things that take something away.
 *
 * Not window.confirm: it cannot be styled to reach the thumb, it blocks the
 * whole page, and it says "localhost:3000 says" above the question.
 */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-60 flex flex-col justify-end bg-black/40">
      <button type="button" aria-label="Cancel" onClick={onCancel} className="flex-1" />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="rounded-t-2xl border-t border-border bg-background px-4 pt-4 inset-safe-bottom pb-4"
      >
        <p className="text-title font-semibold">{title}</p>
        <p className="mt-1 text-body text-foreground-muted">{detail}</p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 w-full rounded-xl border border-border text-body font-medium"
          >
            Keep as it is
          </button>
        </div>
      </div>
    </div>
  );
}
