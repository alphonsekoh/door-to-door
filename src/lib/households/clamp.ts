/*
 * A description as the thread shows it: a long one would push the interest
 * picker, and the Save under it, off the screen, so it is cut and the member
 * opens it. Judged here, in characters and lines, because jsdom cannot see
 * a CSS clamp.
 */
export const CLAMP_LINES = 3;
export const CLAMP_CHARS = 160;

export type Clamped = { shown: string; clipped: boolean };

export function clampDescription(text: string): Clamped {
  const lines = text.split("\n");
  const overLines = lines.length > CLAMP_LINES;
  const head = overLines ? lines.slice(0, CLAMP_LINES).join("\n") : text;
  if (head.length <= CLAMP_CHARS) {
    return overLines
      ? { shown: `${head.trimEnd()}…`, clipped: true }
      : { shown: text, clipped: false };
  }
  /* One character past the limit, so a word ending exactly at it is kept. */
  const window = head.slice(0, CLAMP_CHARS + 1);
  const space = /\s\S*$/.exec(window);
  const cut = space === null ? CLAMP_CHARS : space.index;
  return { shown: `${head.slice(0, cut).trimEnd()}…`, clipped: true };
}
