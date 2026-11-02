import type { FollowUp } from "@/generated/types.gen";
import { firstName } from "@/lib/teams/team-ui";

/*
 * Taking a note away always needs a reason, and says who will read it: the
 * author of a note someone else removed is shown it, and admins see every
 * removal under Dismissed.
 */

export const MAX_REASON_LENGTH = 500;

export type RemovalKind = "dismiss" | "remove" | "withdraw";

export type RemovalCopy = {
  kind: RemovalKind;
  title: string;
  body: string;
  label: string;
  placeholder: string;
  button: string;
  /* Who reads the reason. */
  readers: string;
};

export function removalCopy(
  note: Pick<FollowUp, "status" | "author">,
  isAdmin: boolean,
  viewerId: string | undefined,
): RemovalCopy {
  const author = firstName(note.author.name);
  const own = viewerId !== undefined && note.author.id === viewerId;
  const audit = "Admins will see it under Dismissed.";
  if (!isAdmin) {
    return {
      kind: "withdraw",
      title: "Withdraw your suggestion?",
      body: "Admins will no longer see it for review.",
      label: "Why withdraw it?",
      placeholder: "For example: I picked the wrong unit",
      button: "Withdraw suggestion",
      readers: audit,
    };
  }
  const readers = own ? audit : `${author} and admins will see it.`;
  const told = own ? "Admins can still see it under Dismissed." : null;
  if (note.status === "suggested") {
    return {
      kind: "dismiss",
      title: "Dismiss this suggestion?",
      body: told ?? `${author} will be told it was not added, with your reason.`,
      label: "Why not add it?",
      placeholder: "For example: we visited last week",
      button: "Dismiss suggestion",
      readers,
    };
  }
  return {
    kind: "remove",
    title: "Remove from the follow-up list?",
    body: `It leaves the list and every follow-up session's list. ${told ?? `${author} will be told, with your reason.`}`,
    label: "Why take it off the list?",
    placeholder: "For example: the family has moved",
    button: "Remove from list",
    readers,
  };
}

export type ReasonProblem = "blank" | "too_long";

/* Judged on the trimmed text, which is what is sent and stored. */
export function reasonProblem(reason: string): ReasonProblem | null {
  const length = reason.trim().length;
  if (length === 0) return "blank";
  return length > MAX_REASON_LENGTH ? "too_long" : null;
}

/* The line under the reason field. */
export function reasonNote(problem: ReasonProblem | null, readers: string): string {
  if (problem === "too_long") return `Keep the reason to ${String(MAX_REASON_LENGTH)} characters.`;
  return problem === "blank" ? `Write a reason to continue. ${readers}` : readers;
}
