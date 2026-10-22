import { isPublicPath } from "@/server/auth/routes";

/*
 * Whether the history entry behind the current screen is one of the app's own
 * signed-in screens, so a Back that retraces stays in the app.
 *
 * `history.length` cannot say: it counts the page this tab showed before the
 * app, and the sign-in form a member was sent through. Only a client-side
 * push within this document is certain to have an in-app screen behind it.
 * A full load starts the trail empty, and a browser Back or Forward (which
 * could land anywhere in the stack) empties it again, so in both cases the
 * screen's own address is used instead.
 */
type Trail = { current: string | null; previous: string | null; traversing: boolean };

const trail: Trail = { current: null, previous: null, traversing: false };

export function arrived(pathname: string): void {
  if (pathname === trail.current) return;
  trail.previous = trail.traversing ? null : trail.current;
  trail.traversing = false;
  trail.current = pathname;
}

export function traversed(): void {
  trail.traversing = true;
}

export function canRetrace(): boolean {
  return trail.previous !== null && !isPublicPath(trail.previous);
}

/* A fresh document, for tests. */
export function resetTrail(): void {
  trail.current = null;
  trail.previous = null;
  trail.traversing = false;
}
