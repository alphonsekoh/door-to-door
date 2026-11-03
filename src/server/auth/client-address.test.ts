import { describe, expect, it } from "vitest";
import { UNATTRIBUTED, clientAddress } from "@/server/auth/client-address";

describe("clientAddress", () => {
  it("takes the entry the trusted proxies wrote, counting from the right", () => {
    const header = "198.51.100.7, 203.0.113.9, 192.0.2.1";
    expect(clientAddress(header, 1)).toBe("192.0.2.1");
    expect(clientAddress(header, 2)).toBe("203.0.113.9");
    expect(clientAddress(header, 3)).toBe("198.51.100.7");
  });

  it("reads repeated headers, which Headers.get joins with a comma", () => {
    const headers = new Headers();
    headers.append("x-forwarded-for", "198.51.100.7");
    headers.append("x-forwarded-for", "192.0.2.1");
    expect(clientAddress(headers.get("x-forwarded-for"), 1)).toBe("192.0.2.1");
  });

  it("ignores whatever the client wrote further left", () => {
    // The client sends its own X-Forwarded-For; the proxy appends the real address.
    expect(clientAddress("10.0.0.1, 10.0.0.2, 198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientAddress("10.0.0.1, 198.51.100.7", 1)).toBe(
      clientAddress("172.16.0.9, 198.51.100.7", 1),
    );
  });

  it.each([
    ["no header", null, 1],
    ["fewer entries than proxies", "198.51.100.7", 2],
    ["an empty header", "", 1],
    ["an empty entry", "198.51.100.7, ", 1],
    ["an IPv4 address with a port", "198.51.100.7:443", 1],
    ["a bracketed IPv6 address with a port", "[2001:db8::1]:443", 1],
    ["a hostname", "proxy.internal", 1],
    ["garbage", "not an address", 1],
    ["an IPv4 address with a leading zero", "198.051.100.7", 1],
  ])("is unattributed for %s", (_case, header, hops) => {
    expect(clientAddress(header, hops)).toBe(UNATTRIBUTED);
  });

  it("keys IPv4 on the whole address", () => {
    expect(clientAddress("198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientAddress("198.51.100.8", 1)).not.toBe(clientAddress("198.51.100.7", 1));
  });

  it("keys IPv6 on its /64, so one subscriber's addresses share a budget", () => {
    expect(clientAddress("2001:db8:1:2::1", 1)).toBe("2001:0db8:0001:0002::/64");
    expect(clientAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd", 1)).toBe(
      clientAddress("2001:db8:1:2::1", 1),
    );
    expect(clientAddress("2001:db8:1:3::1", 1)).not.toBe(clientAddress("2001:db8:1:2::1", 1));
  });

  it.each([
    ["the full form", "2001:0db8:0000:0000:0000:0000:0000:0001"],
    ["compressed in the middle", "2001:db8::1"],
    ["compressed at the end", "2001:db8::"],
    ["upper case", "2001:DB8::FFFF:1"],
    ["with a zone", "2001:db8::1%eth0"],
  ])("expands %s to the same /64", (_case, address) => {
    expect(clientAddress(address, 1)).toBe("2001:0db8:0000:0000::/64");
  });

  it("expands an address compressed at the start", () => {
    expect(clientAddress("::1", 1)).toBe("0000:0000:0000:0000::/64");
  });

  it.each([
    ["dotted", "::ffff:198.51.100.7"],
    ["in hex", "::ffff:c633:6407"],
    ["written out", "0:0:0:0:0:ffff:198.51.100.7"],
  ])("keys an IPv4-mapped address %s as the IPv4 address", (_case, address) => {
    expect(clientAddress(address, 1)).toBe("198.51.100.7");
  });

  it("keeps an IPv6 address that merely ends in IPv4 digits as IPv6", () => {
    // 64:ff9b::/96 is NAT64: the IPv6 side's /64 is what identifies it.
    expect(clientAddress("64:ff9b::198.51.100.7", 1)).toBe("0064:ff9b:0000:0000::/64");
  });
});
