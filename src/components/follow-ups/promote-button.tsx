"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ADD_TO_LIST } from "@/lib/follow-ups/rights";
import { describeFollowUpFailure } from "@/lib/history/follow-ups";
import { useOnline } from "@/lib/hooks/use-online";

/*
 * An admin listing a household a member has already suggested: the
 * suggestion goes on the list, in its author's words, rather than a second
 * note beside it that would leave the suggestion waiting and, once
 * dismissed, tell its author it was declined. Online only, as every
 * follow-up change is (D-35-9).
 */
export function PromoteButton({
  suggestionId,
  onPromoted,
  className,
}: {
  suggestionId: string;
  onPromoted: () => void;
  className: string;
}) {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  async function promote(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await apiFetch(`/follow-ups/${suggestionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "listed" }),
      });
      onPromoted();
    } catch (error) {
      setFailure(describeFollowUpFailure(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy || !online}
        onClick={() => void promote()}
        className={className}
      >
        {busy ? "Saving…" : ADD_TO_LIST}
      </button>
      {failure === null ? null : (
        <p role="alert" className="w-full notice-danger">
          {failure}
        </p>
      )}
    </>
  );
}
