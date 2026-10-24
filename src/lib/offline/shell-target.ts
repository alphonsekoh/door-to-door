/*
 * Where the member was going when the offline fallback caught them: the
 * shell is served at the address that failed, so a tap on a household on
 * the follow-up list, or a reload on a block, names the block, and the unit
 * the list filled in. The shell opens it straight after "Continue as".
 * Null for any other address.
 */
export type ShellTarget = { blockId: string; unit: string };

export function shellTarget(pathname: string, search: string): ShellTarget | null {
  const blockId = /^\/blocks\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (blockId === undefined) return null;
  return { blockId, unit: new URLSearchParams(search).get("unit") ?? "" };
}
