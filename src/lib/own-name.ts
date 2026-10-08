/* Matches UpdateOwnProfileRequest.name in the contract. */
export const MAX_NAME_LENGTH = 80;

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/* Shared by the form and the service so a name the page accepts is one the
   server accepts, and the other way round. */
export function checkOwnName(raw: string): NameCheck {
  const name = raw.trim();
  if (name === "") return { ok: false, message: "Enter your name." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Keep your name to ${String(MAX_NAME_LENGTH)} characters.` };
  }
  return { ok: true, name };
}
