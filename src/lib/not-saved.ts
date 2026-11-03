import { ApiRequestError } from "@/lib/api-client";

/*
 * What the Not saved pop-up lists (D-119-13). A Save of a visit or a note
 * refused for a blank unit number or note, or answered with a 400 by the
 * server, opens a dialog naming every reason refused at that moment, in the
 * form's own order, and OK returns focus to the first field at fault.
 *
 * Shared by the visit forms and the follow-up sheet, so it sits beside
 * api-client rather than in either domain's folder (D-119-18).
 */

export type NotSavedField = "memberId" | "blockId" | "unitNumber" | "interestLevel" | "note";

/* What the dialog leads with, above the reasons. */
export const VISIT_NOT_SAVED = "This visit could not be saved because:";
export const NOTE_NOT_SAVED = "This note could not be saved because:";

export const REASONS: Record<NotSavedField, string> = {
  memberId: "No member is chosen.",
  blockId: "No block is chosen.",
  unitNumber: "The unit number is blank.",
  interestLevel: "No interest level is chosen.",
  note: "The note is blank.",
};

/* Typed text, where a blank opens the pop-up. A choice not made alone keeps
   to the line beside Save (D-33-29). */
const BLANK_TEXT: readonly NotSavedField[] = ["unitNumber", "note"];

/*
 * What the server's refusal of each field says. The forms send text trimmed,
 * and the server refuses it for more than being blank (a unit past 32
 * characters, say), so it names the rule rather than claim the field was
 * empty. A choice it refuses was made, so it is not called missing.
 */
const REFUSED_BY_SERVER: Record<NotSavedField, string> = {
  memberId: "The member was not accepted.",
  blockId: "The block was not accepted.",
  unitNumber: "The unit number is blank or too long.",
  interestLevel: "The interest level was not accepted.",
  note: "The note is blank or too long.",
};

export type NotSaved = {
  reasons: string[];
  /* Takes focus after OK; null when the form has no field to point at. */
  field: NotSavedField | null;
};

/* The reasons for a Save the form refused itself, or null for no pop-up. */
export function notSavedForBlank(
  refused: readonly NotSavedField[],
  order: readonly NotSavedField[],
): NotSaved | null {
  const atFault = order.filter((field) => refused.includes(field));
  const [first] = atFault;
  if (first === undefined || !atFault.some((field) => BLANK_TEXT.includes(field))) return null;
  return { reasons: atFault.map((field) => REASONS[field]), field: first };
}

export type ServerNotSaved = NotSaved & {
  /* What to say under each of the form's own fields the server named. */
  fields: Partial<Record<NotSavedField, string>>;
};

const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/*
 * The reasons for a Save the server refused as invalid, or null for any
 * other failure. Issues are matched to the form's fields by the last segment
 * of their path; one the form has no field for keeps the server's words
 * (D-119-16).
 */
export function notSavedFromServer(
  error: unknown,
  order: readonly NotSavedField[],
): ServerNotSaved | null {
  if (
    !(error instanceof ApiRequestError) ||
    error.status !== 400 ||
    error.code !== "validation_failed"
  ) {
    return null;
  }
  const issues = error.details.map((issue) => ({
    name: lastSegment(issue.path),
    message: issue.message,
  }));
  const atFault = order.filter((field) => issues.some((issue) => issue.name === field));
  const fields: Partial<Record<NotSavedField, string>> = {};
  for (const field of atFault) fields[field] = REFUSED_BY_SERVER[field];
  const others = issues
    .filter((issue) => !atFault.some((field) => field === issue.name))
    .map((issue) => issue.message);
  const reasons = [...new Set([...atFault.map((field) => REFUSED_BY_SERVER[field]), ...others])];
  return {
    reasons: reasons.length === 0 ? [error.message] : reasons,
    field: atFault[0] ?? null,
    fields,
  };
}

/* The same reasons, on the one line beside Save. */
export function notSavedLine({ reasons }: NotSaved): string {
  return `Not saved. ${reasons.join(" ")}`;
}
