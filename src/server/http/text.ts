import { ValidationError } from "@/server/http/errors";

/*
 * Text that must say something, as it is stored: trimmed, and refused when
 * nothing is left (#119). The contract's `pattern: "\S"` refuses the same
 * values first; this holds for any caller that does not pass through it.
 * JavaScript's `\s` and `trim()` strip the same characters, so the two never
 * disagree about what is blank.
 */
export const BLANK_MESSAGE = "Must contain something other than spaces.";

export function requireText(value: string, path: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new ValidationError("Invalid request body.", [{ path, message: BLANK_MESSAGE }]);
  }
  return trimmed;
}
