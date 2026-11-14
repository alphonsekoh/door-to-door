/*
 * The only hosts `next dev` answers (#124). A DNS-rebound page reaches a
 * loopback-bound server under its own name, so the Host header, not the bind
 * address, is what tells the developer's own browser from someone else's page.
 * next.config.ts gives Next's dev endpoints the same list (allowedDevOrigins).
 */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

const LOOPBACK: ReadonlySet<string> = new Set(LOOPBACK_HOSTS);

export function isLoopbackHost(host: string | null): boolean {
  if (host === null) return false;
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  /* Anything beyond host[:port], such as `evil.test@localhost`, is no Host a browser sends. */
  return url.href === `${url.origin}/` && LOOPBACK.has(url.hostname);
}
