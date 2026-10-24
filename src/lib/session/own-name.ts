/* Matches UpdateOwnProfileRequest.name in the contract. */
export const MAX_NAME_LENGTH = 80;

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/* Characters that print nothing or reorder what is around them: controls, and
   format characters such as zero-width spaces and the bidi overrides. */
export const NON_PRINTING = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;
/* Pictographs count: an emoji-only name is a name, but "..." is not. */
export const HAS_SUBSTANCE = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/* Length in code points, so an emoji is one character here as it is to the
   person typing it and to OpenAPI's maxLength. */
export function nameLength(name: string): number {
  return Array.from(name).length;
}

/*
 * The one rule for a display name, shared by the form, the service and the
 * session token: trim first, then count code points on what remains. A name
 * that would render blank or spoof another (zero-width, bidi override) is
 * refused, since the name is what teammates read in lists and history.
 */
export function checkOwnName(raw: string): NameCheck {
  const name = raw.trim();
  if (name === "") return { ok: false, message: "Enter your name." };
  if (nameLength(name) > MAX_NAME_LENGTH) {
    return { ok: false, message: `Keep your name to ${String(MAX_NAME_LENGTH)} characters.` };
  }
  if (NON_PRINTING.test(name)) {
    return { ok: false, message: "Your name has characters that cannot be shown." };
  }
  if (!HAS_SUBSTANCE.test(name)) {
    return { ok: false, message: "Your name needs at least one letter or number." };
  }
  return { ok: true, name };
}

export const NAME_FALLBACK = "Someone";

/* A user with no name still has to be listed and tapped. */
export function displayName(name: string | null): string {
  return name === null || name.trim() === "" ? NAME_FALLBACK : name.trim();
}

export function firstName(name: string | null): string {
  return displayName(name).replace(/\s.*$/, "");
}
