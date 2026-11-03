import { ApiRequestError } from "@/lib/api-client";
import { MAX_UNIT_NUMBER_LENGTH, type UnitFault } from "@/lib/units/unit-number";

/*
 * What the Not saved pop-up lists (D-119-13). A Save of a visit or a note
 * refused for a blank unit number or note, or a unit number too long, or
 * answered with a 400 by the server, opens a dialog naming every reason
 * refused at that moment, in the form's own order, and OK returns focus to
 * the first field at fault.
 *
 * Shared by the visit forms and the follow-up sheet, so it sits beside
 * api-client rather than in either domain's folder (D-119-18).
 */

export type NotSavedField = "memberId" | "blockId" | "unitNumber" | "interestLevel" | "note";

/* What the dialog leads with, above the reasons. */
export const VISIT_NOT_SAVED = "This visit could not be saved because:";
export const NOTE_NOT_SAVED = "This note could not be saved because:";

/*
 * What a form refuses a field for: blank, or a choice not made, or a unit
 * number past the contract's limit. Only a unit is refused for its length; a
 * note counts down to its own (D-74-8).
 */
export type Refusal = NotSavedField | "unitNumberTooLong";

/* Said in the pop-up and under the field alike. */
export const UNIT_TOO_LONG = `The unit number is too long (${String(MAX_UNIT_NUMBER_LENGTH)} characters at most).`;

export const REASONS: Record<Refusal, string> = {
  memberId: "No member is chosen.",
  blockId: "No block is chosen.",
  unitNumber: "The unit number is blank.",
  unitNumberTooLong: UNIT_TOO_LONG,
  interestLevel: "No interest level is chosen.",
  note: "The note is blank.",
};

/* What the pop-up names for each fault of a unit number. */
export const UNIT_REFUSAL: Record<UnitFault, Refusal> = {
  blank: "unitNumber",
  too_long: "unitNumberTooLong",
};

const fieldOf = (refusal: Refusal): NotSavedField =>
  refusal === "unitNumberTooLong" ? "unitNumber" : refusal;

/* Typed text, whose refusal opens the pop-up. A choice not made alone keeps
   to the line beside Save (D-33-29). */
const TYPED: readonly Refusal[] = ["unitNumber", "unitNumberTooLong", "note"];

/*
 * What the server's refusal of each field says. Its issue does not say which
 * rule the text broke, and the forms check both before sending, so it names
 * both rather than claim the field was empty. A choice it refuses was made,
 * so it is not called missing.
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
export function notSavedByForm(
  refused: readonly Refusal[],
  order: readonly NotSavedField[],
): NotSaved | null {
  const atFault = order.flatMap((field) => refused.filter((refusal) => fieldOf(refusal) === field));
  const [first] = atFault;
  if (first === undefined || !atFault.some((refusal) => TYPED.includes(refusal))) return null;
  return { reasons: atFault.map((refusal) => REASONS[refusal]), field: fieldOf(first) };
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
