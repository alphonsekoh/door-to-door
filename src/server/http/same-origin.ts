/*
 * Refuses writes another origin sent with the member's cookie (#121).
 *
 * The session cookie is SameSite=Lax, which separates sites, not origins: a
 * sibling subdomain still gets it on a CORS-simple POST that needs no
 * preflight. These checks close that gap without knowing the deployed domain.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/* `none` is a request the user started (address bar, bookmark), never a page. */
const TRUSTED_FETCH_SITES = new Set(["same-origin", "none"]);

/* A proxy appends to X-Forwarded-Host, so the first entry is what the browser asked for. */
function firstHost(header: string | null): string {
  return (header ?? "").replace(/,.*/s, "").trim().toLowerCase();
}

/* Request.url is built from the bind address, so behind a proxy it names
   localhost; the Host the browser sent, or the proxy forwarded, is the real one. */
function ownHosts(headers: Headers): string[] {
  return [firstHost(headers.get("x-forwarded-host")), firstHost(headers.get("host"))].filter(
    (host) => host !== "",
  );
}

/* URL drops a default port from the Origin, but a proxy may still forward it
   (`X-Forwarded-Host: app.example.org:443`). Only the Origin's own scheme's
   default goes, so `:80` never stands in for an https page. */
const DEFAULT_PORTS = new Map([
  ["https:", ":443"],
  ["http:", ":80"],
]);

function withoutDefaultPort(host: string, protocol: string): string {
  const port = DEFAULT_PORTS.get(protocol);
  return port !== undefined && host.endsWith(port) ? host.slice(0, -port.length) : host;
}

function isOwnOrigin(origin: string, headers: Headers): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return ownHosts(headers).some((host) => withoutDefaultPort(host, url.protocol) === url.host);
}

export function isCrossOriginWrite(method: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;

  // A page's script can neither set nor change it, so when present it decides alone (D-121-2).
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "") return !TRUSTED_FETCH_SITES.has(site);

  // Not a browser acting for a page, so not a request a page could forge.
  const origin = headers.get("origin");
  if (origin === null) return false;

  return !isOwnOrigin(origin, headers);
}

/* The essence of the media type, so `application/json; charset=utf-8` passes
   and a CORS-simple `text/plain` does not. */
export function isJsonMediaType(contentType: string | null): boolean {
  return (contentType ?? "").replace(/;.*/s, "").trim().toLowerCase() === "application/json";
}
