"use client";

import { useRef, useState } from "react";
import { AlsoAddRow, useAlsoAdd } from "@/components/follow-ups/also-add";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { FollowUpDoor, WholeWords } from "@/components/ui/unit-number";
import type { FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  ADDED_TO_LIST,
  type AddOutcome,
  type HalfAdded,
  intoSession,
  listThenAdd,
  partialMessage,
} from "@/lib/follow-ups/add-to-list";
import {
  FOLLOW_UP_OFFLINE_NOTE,
  addedByline,
  describeFollowUpFailure,
} from "@/lib/history/follow-ups";
import { formatDay } from "@/lib/history/dates";
import { useOnline } from "@/lib/hooks/use-online";
import { useRole } from "@/lib/hooks/use-role";

/*
 * An admin putting a member's suggestion on the follow-up list, in its
 * author's words, and into a follow-up session in the same tap. A sheet
 * rather than a one-tap button, so the suggestion is read before it is owed
 * and the session can be chosen. Online only, as every follow-up change is
 * (D-35-9).
 */
export function PromoteSheet({
  suggestion,
  onClose,
  onPromoted,
}: {
  suggestion: FollowUp;
  onClose: () => void;
  /* Told what to say: the parent shows it once the sheet has gone. */
  onPromoted: (message: string) => void;
}) {
  const online = useOnline();
  const { userId } = useRole();
  const also = useAlsoAdd(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Listed, but not added to the session: only that step is retried. */
  const [partial, setPartial] = useState<HalfAdded | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  async function run(step: () => Promise<string | null>): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const message = await step();
      if (message !== null) onPromoted(message);
    } catch (error) {
      setFailure(describeFollowUpFailure(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /* What to say once done, or the half done, kept open to say why. */
  const settle = (outcome: AddOutcome): string | null => {
    if (outcome.status === "done") return outcome.message;
    setPartial(outcome.half);
    return null;
  };

  function promote(): void {
    void run(async () =>
      settle(
        await listThenAdd(
          () =>
            apiFetch(`/follow-ups/${suggestion.id}`, {
              method: "PATCH",
              body: JSON.stringify({ status: "listed" }),
            }),
          suggestion.householdId,
          also.chosen,
        ),
      ),
    );
  }

  function retry({ target }: HalfAdded): void {
    void run(async () => settle(await intoSession(target, suggestion.householdId)));
  }

  const title = "Add to the follow-up list";

  return (
    <Sheet
      label={`${title}, ${suggestion.unitNumber}`}
      title={
        <>
          <WholeWords text={title} />
          <span className="block text-body font-normal text-foreground-muted tabular-nums">
            <FollowUpDoor note={suggestion} />
          </span>
        </>
      }
      onClose={
        partial === null
          ? onClose
          : () => {
              onPromoted(ADDED_TO_LIST);
            }
      }
    >
      <div className="mt-2 rounded-lg border border-dashed border-border-strong bg-surface p-3">
        <p className="text-body break-words whitespace-pre-wrap">{suggestion.note}</p>
        {suggestion.dueDate === null ? null : (
          <p className="text-caption text-foreground-muted">
            Go back by {formatDay(suggestion.dueDate)}
          </p>
        )}
        <p className="mt-1 text-caption break-words text-foreground-muted">
          {addedByline(suggestion, userId)}
        </p>
      </div>

      {failure === null ? null : (
        <p role="alert" className="mt-3 notice-danger">
          {failure}
        </p>
      )}
      {partial === null ? (
        <AlsoAddRow also={also} />
      ) : (
        <p role="alert" className="mt-3 notice-danger">
          {partialMessage(partial)}
        </p>
      )}

      <SheetActions note={online ? null : FOLLOW_UP_OFFLINE_NOTE}>
        {partial === null ? (
          <button
            type="button"
            disabled={busy || !online || also.looking}
            onClick={promote}
            className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
          >
            {busy ? "Saving…" : "Add to list"}
          </button>
        ) : partial.refused === null ? (
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => {
              retry(partial);
            }}
            className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold break-words"
          >
            {busy ? "Saving…" : `Add to ${partial.target.title}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onPromoted(ADDED_TO_LIST);
            }}
            className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
          >
            Done
          </button>
        )}
      </SheetActions>
    </Sheet>
  );
}
