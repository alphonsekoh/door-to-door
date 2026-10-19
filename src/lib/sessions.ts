import type { SessionStatus } from "@/generated/types.gen";

/*
 * What an admin may do to an outing, and what to call it.
 *
 * Kept out of the components because getting it wrong is how a session ends up
 * unrecoverable: an ended outing must always offer reopen, or a member who is
 * mid-amendment loses their work.
 */

export type SessionAction = "start" | "end" | "reopen";

export type ActionSpec = {
  action: SessionAction;
  label: string;
  /* Ending locks members out until someone reopens, so it asks first. */
  confirm: string | null;
  /* Styled as taking something away, the same on the list and the detail. */
  destructive: boolean;
};

const SPECS: Record<SessionStatus, ActionSpec[]> = {
  draft: [{ action: "start", label: "Start outing", confirm: null, destructive: false }],
  active: [
    {
      action: "end",
      label: "End outing",
      confirm: "Members will not be able to record or amend until it is reopened.",
      destructive: true,
    },
  ],
  ended: [{ action: "reopen", label: "Reopen outing", confirm: null, destructive: false }],
};

export function availableActions(status: SessionStatus): ActionSpec[] {
  return SPECS[status];
}

const LABELS: Record<SessionStatus, string> = {
  draft: "Draft",
  active: "Running now",
  ended: "Ended",
};

export function statusLabel(status: SessionStatus): string {
  return LABELS[status];
}
