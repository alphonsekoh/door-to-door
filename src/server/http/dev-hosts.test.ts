import { describe, expect, it } from "vitest";
import { LOOPBACK_HOSTS, isLoopbackHost } from "@/server/http/dev-hosts";

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "localhost:3000",
    "LOCALHOST:3000",
    "127.0.0.1",
    "127.0.0.1:3124",
    "[::1]",
    "[::1]:3000",
    // A browser leaves the default port out, but a client may not.
    "localhost:80",
  ])("accepts %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    // What a DNS-rebound page sends: its own name, whatever address it resolved to.
    "evil.test",
    "evil.test:3000",
    "localhost.evil.test",
    "localhost.evil.test:3000",
    "127.0.0.1.nip.io",
    "127.0.0.1.nip.io:3000",
    // The machine's other addresses are reachable from the LAN.
    "192.168.1.20:3000",
    "0.0.0.0:3000",
    // Only the hostname counts, and nothing may ride along with it.
    "localhost@evil.test",
    "evil.test@localhost",
    "localhost/evil",
    "localhost?evil",
    "localhost#evil",
    "localhost.",
    "",
    "localhost:port",
  ])("refuses %j", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  it("refuses a request with no Host at all", () => {
    expect(isLoopbackHost(null)).toBe(false);
  });

  it("lists exactly the three loopback names", () => {
    expect(LOOPBACK_HOSTS).toEqual(["localhost", "127.0.0.1", "[::1]"]);
  });
});
