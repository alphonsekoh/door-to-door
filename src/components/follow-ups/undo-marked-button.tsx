"use client";

/*
 * Undo for what saving a visit marked done, wherever that save is
 * confirmed. A word this short needs a minimum width as well as a height to
 * be a full tap target.
 */
export function UndoMarkedButton({
  count,
  undoing,
  disabled = false,
  onUndo,
}: {
  count: number;
  undoing: boolean;
  disabled?: boolean;
  onUndo: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || undoing}
      onClick={onUndo}
      className="min-h-11 min-w-11 shrink-0 font-medium btn-text"
    >
      {undoing ? (
        "Undoing…"
      ) : (
        <>
          Undo{" "}
          <span className="sr-only">
            {count === 1 ? "marking the follow-up done" : "marking the follow-ups done"}
          </span>
        </>
      )}
    </button>
  );
}
