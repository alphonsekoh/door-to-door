import { ApiRequestError } from "@/lib/api-client";

/*
 * The line a screen shows when a request fails: the server's sentence for a
 * refusal, and the screen's own for anything else. With no answer, fetch
 * rejects with the browser's words ("Failed to fetch", "Load failed"), which
 * were never written for a member (#194).
 */
export function failureLine(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}
