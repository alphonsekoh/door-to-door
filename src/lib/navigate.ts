/*
 * A full page load, not a router push. Used where the app's auth state has just
 * changed: a fresh document starts with an empty router cache, so nothing
 * fetched under the previous state can be replayed, and there is no in-flight
 * client navigation left to fail and fall back to the page being left.
 */
export function goTo(path: string): void {
  window.location.assign(path);
}

const PLACEHOLDER_ORIGIN = "http://this-origin.invalid";

function staysHere(target: string): URL | null {
  try {
    const url = new URL(target, PLACEHOLDER_ORIGIN);
    return url.origin === PLACEHOLDER_ORIGIN ? url : null;
  } catch {
    // An unparseable absolute URL ("http://[") would also fail to navigate.
    return null;
  }
}

/*
 * The callback comes from the query string, so anyone can write it into a link.
 * It is resolved the way the browser will resolve it, not pattern-matched: the
 * URL parser strips tab, CR and LF and reads "\" as "/", so "/\t/evil.example"
 * passes a check on the raw string and still lands on another site. The path
 * that comes out is resolved a second time, because dot segments can collapse
 * to one starting "//" ("/.//evil.example"), which is another origin again.
 */
export function destinationAfterSignIn(callbackUrl: string | null): string {
  const url = callbackUrl === null ? null : staysHere(callbackUrl);
  const path = url === null ? "/" : url.pathname + url.search + url.hash;
  return staysHere(path) === null ? "/" : path;
}
