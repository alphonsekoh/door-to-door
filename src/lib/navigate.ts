/*
 * A full page load, not a router push. Used where the app's auth state has just
 * changed: a fresh document starts with an empty router cache, so nothing
 * fetched under the previous state can be replayed, and there is no in-flight
 * client navigation left to fail and fall back to the page being left.
 */
export function goTo(path: string): void {
  window.location.assign(path);
}

/*
 * The callback comes from the query string, so anyone can write it into a link.
 * Only a path on this origin is followed: "//host" and "/\host" are read by
 * browsers as another origin, and a full navigation would also run "javascript:".
 */
export function destinationAfterSignIn(callbackUrl: string | null): string {
  return callbackUrl !== null && /^\/(?![/\\])/.test(callbackUrl) ? callbackUrl : "/";
}
