"use client";

import { useState } from "react";
import { EraseSheet, type EraseMode } from "@/components/privacy/erase-sheet";
import { SheetPresence } from "@/components/ui/sheet";
import type { Household } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { useRole } from "@/lib/hooks/use-role";

const NO_ANSWER = "Could not save that. Check your connection and try again.";

/*
 * What to do when a household says "delete what you have on us" or "don't call
 * me" (#279), on the unit's panel, at the door and on its page.
 *
 * A member passes a request on; an admin erases (on the unit's page, where
 * the whole unit is in front of them) or, at the door, passes it on like a
 * member. Either may mark a withdrawn agreement, since it only ever stops the
 * team using the contact; only an admin allows it again. Hidden when the unit
 * holds nothing. Which buttons show is affordance: each call is checked by
 * the server for the caller's role.
 */
export function PrivacyActions({
  household,
  holdsData,
  atDoor,
  onChanged,
}: {
  household: Household;
  holdsData: boolean;
  atDoor: boolean;
  onChanged: () => void;
}) {
  const { isAdmin } = useRole();
  const [sheet, setSheet] = useState<EraseMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!holdsData) return null;

  const eraseHere = isAdmin && !atDoor;
  const withdrawn = household.contactWithdrawnAt != null;

  async function withdrawal(method: "POST" | "DELETE", done: string): Promise<void> {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await apiFetch(`/households/${household.id}/contact-withdrawal`, { method });
      setNotice(done);
      onChanged();
    } catch (error) {
      setFailure(failureLine(error, NO_ANSWER));
    } finally {
      setBusy(false);
    }
  }

  const button = "min-h-11 w-full btn-secondary rounded-lg px-3 text-body font-medium";

  return (
    <div className="mt-4 space-y-2">
      {notice === null ? null : (
        <p role="status" className="notice-success">
          {notice}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="notice-danger">
          {failure}
        </p>
      )}
      {household.contact !== null && !withdrawn ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void withdrawal("POST", "Marked. The team will not call or message them.")}
          className={button}
        >
          Withdrew agreement to calls or messages
        </button>
      ) : null}
      {withdrawn && isAdmin ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void withdrawal("DELETE", "They can be called or messaged again.")}
          className={button}
        >
          Allow calls or messages again
        </button>
      ) : null}
      {eraseHere ? (
        <button
          type="button"
          onClick={() => {
            setSheet("erase");
          }}
          className="min-h-11 w-full btn-danger-outline rounded-lg px-3 text-body font-medium"
        >
          Erase this unit&apos;s data…
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSheet("pass_on");
          }}
          className={button}
        >
          They asked us to delete their data
        </button>
      )}

      <SheetPresence>
        {sheet === null ? null : (
          <EraseSheet
            subject={{
              kind: "household",
              id: household.id,
              label: household.name ?? household.unitNumber,
            }}
            mode={sheet}
            onClose={() => {
              setSheet(null);
            }}
            onDone={(message) => {
              setSheet(null);
              setNotice(message);
              onChanged();
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}
