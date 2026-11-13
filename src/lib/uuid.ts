/*
 * UUIDv7: a 48-bit millisecond timestamp, then version and variant bits, then
 * randomness.
 *
 * The client generates visit ids, so they must be unique without coordination
 * and sort by creation time - the offline queue relies on both. v4 would be
 * unique but unordered, which makes a queue flushed out of order harder to
 * reason about.
 */

const VERSION_7 = 0x70;
const VARIANT_RFC = 0x80;

export function uuidv7(now: number = Date.now(), random: () => number = Math.random): string {
  const bytes = new Uint8Array(16);

  /* 48-bit big-endian timestamp. */
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = now % 256;
    now = Math.floor(now / 256);
  }

  /*
   * Version and variant bits are applied as each byte is generated rather than
   * by reading it back: re-reading a Uint8Array index yields `number |
   * undefined` under noUncheckedIndexedAccess, and the fallback would be a
   * branch no test could ever reach.
   */
  for (let i = 6; i < 16; i += 1) {
    let byte = Math.floor(random() * 256);
    if (i === 6) {
      // Version 7 in the high nibble.
      byte = (byte & 0x0f) | VERSION_7;
    }
    if (i === 8) {
      // RFC 4122 variant in the top two bits.
      byte = (byte & 0x3f) | VARIANT_RFC;
    }
    bytes[i] = byte;
  }

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/*
 * The same id, in either case. A path's id is checked as a UUID, which takes
 * upper case, while ids from the database and the session are lower case.
 */
export function sameUuid(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/*
 * Postgres's order for uuids, so rows locked in chunks are locked in the order
 * each chunk's ORDER BY takes them: it compares their bytes, which is the
 * order of their lower-case text.
 */
export function compareUuids(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 0;
  return x < y ? -1 : 1;
}
