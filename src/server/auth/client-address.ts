import { isIP } from "node:net";

/*
 * Who is signing in, as far as the reverse proxies in front of the app can
 * vouch for it (#120).
 *
 * Each trusted proxy appends the address it received the request from, so the
 * entry `hops` places from the right was written by the outermost trusted
 * proxy. Anything further left came from the client and may be forged. Next
 * fills X-Forwarded-For with the socket address only when it is absent and
 * never appends, so without a proxy the whole header is the client's to write.
 * That is why the caller does not ask at all when trustedProxyHops is 0.
 */

/* The one bucket for an attempt whose client cannot be told. Not an IP, so it cannot collide with one. */
export const UNATTRIBUTED = "unattributed";

const MAPPED_IPV4_PREFIX = "0000:0000:0000:0000:0000:ffff:";

/* Eight groups of four hex digits, with any zone dropped and an embedded IPv4 turned into two groups. */
function expandIpv6(address: string): string {
  const hex = address
    .replace(/%.*$/, "")
    .replace(
      /(\d+)\.(\d+)\.(\d+)\.(\d+)$/,
      (_match, a: string, b: string, c: string, d: string) =>
        `${(Number(a) * 256 + Number(b)).toString(16)}:${(Number(c) * 256 + Number(d)).toString(16)}`,
    );
  const written = hex.split(":").filter((group) => group !== "").length;
  return hex
    .replace("::", `:${"0:".repeat(8 - written)}`)
    .split(":")
    .filter((group) => group !== "")
    .map((group) => group.padStart(4, "0").toLowerCase())
    .join(":");
}

/*
 * IPv4 is keyed as it is. IPv6 is keyed on its /64, since one subscriber is
 * usually handed a whole /64 and can move within it at will; an IPv4-mapped
 * address is the IPv4 address it carries.
 */
function keyFor(address: string): string {
  if (isIP(address) === 4) {
    return address;
  }
  const full = expandIpv6(address);
  if (full.startsWith(MAPPED_IPV4_PREFIX)) {
    const bits = full.slice(MAPPED_IPV4_PREFIX.length).replace(":", "");
    return [0, 2, 4, 6].map((at) => String(parseInt(bits.slice(at, at + 2), 16))).join(".");
  }
  return `${full.slice(0, 19)}::/64`;
}

export function clientAddress(forwardedFor: string | null, hops: number): string {
  if (forwardedFor === null) {
    return UNATTRIBUTED;
  }
  const entries = forwardedFor.split(",").map((entry) => entry.trim());
  const entry = entries[entries.length - hops];
  return entry === undefined || isIP(entry) === 0 ? UNATTRIBUTED : keyFor(entry);
}
