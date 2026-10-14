/*
 * Server-side error logging that is safe to run during an outage. A database
 * going away makes every request fail at once, and the raw error carries the
 * host, port, query parameters (user ids) and a cause chain. One sanitised
 * line per burst is what an operator needs; the rest is noise or a leak.
 */

const MAX_MESSAGE = 200;

const REDACTIONS: [RegExp, string][] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]"],
  [/[^\s@()]+@[^\s@()]+\.[^\s@()]+/g, "[email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  // Postgres echoes the offending row in "Key (col)=(value)".
  [/=\([^)]*\)/g, "=([value])"],
  [/\[?(?<![0-9a-z])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\]?(?::\d+)?/gi, "[host]"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[host]"],
  [/\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*:\d{2,5}\b/gi, "[host]"],
];

export function sanitizeMessage(raw: string): string {
  // Drizzle appends "params: ..." on the next line; only the first line is kept.
  const newline = raw.indexOf("\n");
  const firstLine = newline === -1 ? raw : raw.slice(0, newline);
  const clean = REDACTIONS.reduce(
    (text, [pattern, mask]) => text.replace(pattern, mask),
    firstLine,
  );
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}...` : clean;
}

function codeOf(value: unknown): string | undefined {
  const code = (value as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/*
 * Name, code and a sanitised first line. A wrapped error's own message is
 * usually generic, so the cause's code is borrowed - only the code, never the
 * cause's message or properties.
 */
export function summarizeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause: unknown = error.cause;
  const code = codeOf(error) ?? codeOf(cause);
  const label = [error.name, code].filter((part) => part !== undefined).join(" ");
  return `${label}: ${sanitizeMessage(error.message)}`;
}

export type ThrottledLog = (key: string, line: string) => void;

type ThrottleOptions = {
  log?: (line: string) => void;
  now?: () => number;
  quietMs?: number;
};

const clockTime = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)}Z`;

/*
 * Logs the first line for a key, then stays quiet for `quietMs`. The next line
 * says how many were swallowed and since when, so a count from a burst hours
 * ago cannot be mistaken for part of the new one.
 */
export function createThrottledLog({
  log = (line) => {
    console.error(line);
  },
  now = () => Date.now(),
  quietMs = 5_000,
}: ThrottleOptions = {}): ThrottledLog {
  const state = new Map<string, { loggedAt: number; suppressed: number }>();

  return (key, line) => {
    const at = now();
    const previous = state.get(key);
    if (previous && at - previous.loggedAt < quietMs) {
      previous.suppressed += 1;
      return;
    }
    const extra =
      previous && previous.suppressed > 0
        ? ` (${String(previous.suppressed)} similar suppressed since ${clockTime(previous.loggedAt)})`
        : "";
    state.set(key, { loggedAt: at, suppressed: 0 });
    log(`${line}${extra}`);
  };
}
