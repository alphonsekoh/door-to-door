import { describe, expect, it } from "vitest";
import { isCrossOriginWrite, isJsonMediaType } from "@/server/http/same-origin";

const refused = (method: string, headers: Record<string, string>) =>
  isCrossOriginWrite(method, new Headers(headers));

describe("isCrossOriginWrite: Sec-Fetch-Site", () => {
  it.each(["same-origin", "none"])("lets %s through", (site) => {
    // `none` is a navigation the user started, which no page can forge.
    expect(refused("POST", { "sec-fetch-site": site })).toBe(false);
  });

  it.each(["same-site", "cross-site", "Same-Origin", "nonsense"])("refuses %s", (site) => {
    // same-site is the case the issue is about: a sibling subdomain gets the cookie.
    expect(refused("POST", { "sec-fetch-site": site })).toBe(true);
  });

  it("decides alone when present, whatever the Origin says", () => {
    // No browser sends this pair, and checking both would make every write
    // depend on the proxy forwarding Host correctly.
    expect(
      refused("POST", {
        "sec-fetch-site": "same-origin",
        origin: "https://other.example.org",
        host: "app.example.org",
      }),
    ).toBe(false);
    expect(
      refused("POST", {
        "sec-fetch-site": "cross-site",
        origin: "https://app.example.org",
        host: "app.example.org",
      }),
    ).toBe(true);
  });

  it("falls back to the Origin when it is empty", () => {
    expect(
      refused("POST", {
        "sec-fetch-site": "",
        origin: "https://other.example.org",
        host: "app.example.org",
      }),
    ).toBe(true);
  });
});

describe("isCrossOriginWrite: methods", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("never refuses a %s", (method) => {
    expect(refused(method, { "sec-fetch-site": "cross-site" })).toBe(false);
  });

  it.each(["POST", "PATCH", "DELETE", "PUT"])("checks a %s", (method) => {
    expect(refused(method, { "sec-fetch-site": "cross-site" })).toBe(true);
  });
});

describe("isCrossOriginWrite: Origin, when there is no Sec-Fetch-Site", () => {
  // A phone on plain http over the LAN gets no Sec-Fetch-Site: browsers send it
  // only to secure origins.
  it("lets a write through when Origin matches Host", () => {
    expect(refused("POST", { origin: "http://192.168.1.20:3000", host: "192.168.1.20:3000" })).toBe(
      false,
    );
  });

  it("uses the first X-Forwarded-Host when the proxy rewrote Host", () => {
    expect(
      refused("POST", {
        origin: "https://app.example.org",
        "x-forwarded-host": "app.example.org, proxy.internal",
        host: "app:3000",
      }),
    ).toBe(false);
  });

  it("does not take a later X-Forwarded-Host entry as the app's", () => {
    expect(
      refused("POST", {
        origin: "https://proxy.internal",
        "x-forwarded-host": "app.example.org, proxy.internal",
        host: "app:3000",
      }),
    ).toBe(true);
  });

  it("refuses a sibling subdomain", () => {
    expect(refused("POST", { origin: "https://cms.example.org", host: "app.example.org" })).toBe(
      true,
    );
  });

  it("refuses the same host on another port", () => {
    expect(
      refused("POST", { origin: "http://app.example.org:8080", host: "app.example.org" }),
    ).toBe(true);
  });

  it("matches the default port, which the Origin omits", () => {
    expect(refused("POST", { origin: "https://app.example.org", host: "app.example.org" })).toBe(
      false,
    );
  });

  describe("a default port in the Host", () => {
    // The Origin never names its scheme's default port, but a proxy that
    // forwards `$host:$server_port` does.
    it.each([
      ["https://example.org", "host", "example.org:443"],
      ["http://example.org", "host", "example.org:80"],
      ["https://example.org", "x-forwarded-host", "example.org:443, proxy.internal"],
      ["http://example.org", "x-forwarded-host", "example.org:80"],
      ["https://example.org", "host", "EXAMPLE.org:443"],
      ["https://Example.ORG", "x-forwarded-host", "example.ORG:443"],
      ["https://example.org:8443", "host", "example.org:8443"],
    ])("lets %s through when %s is %s", (origin, header, value) => {
      expect(refused("POST", { origin, host: "app:3000", [header]: value })).toBe(false);
    });

    it.each([
      // Only the Origin's own scheme's default is dropped.
      ["https://example.org", "example.org:80"],
      ["http://example.org", "example.org:443"],
      // Any other port has to match exactly.
      ["https://example.org", "example.org:8443"],
      ["https://example.org:8443", "example.org:443"],
      ["https://example.org:8443", "example.org"],
    ])("refuses %s when Host is %s", (origin, host) => {
      expect(refused("POST", { origin, host })).toBe(true);
    });
  });

  it("compares hosts case-insensitively", () => {
    expect(refused("POST", { origin: "https://App.Example.org", host: "APP.example.ORG" })).toBe(
      false,
    );
    expect(
      refused("POST", { origin: "https://app.example.org", "x-forwarded-host": "APP.Example.org" }),
    ).toBe(false);
  });

  it.each(["null", "not a url", "file:///etc/passwd"])("refuses an Origin of %s", (origin) => {
    // `null` comes from sandboxed frames and file pages, which still carry cookies.
    expect(refused("POST", { origin, host: "app.example.org" })).toBe(true);
  });

  it("refuses an Origin when there is no host to compare it with", () => {
    expect(refused("POST", { origin: "https://app.example.org" })).toBe(true);
  });

  it("lets through a request that sends neither header", () => {
    // Scripts, tests and Playwright setup calls: not a browser acting for a page.
    expect(refused("POST", { host: "app.example.org" })).toBe(false);
  });
});

describe("isJsonMediaType", () => {
  it.each([
    "application/json",
    "application/json; charset=utf-8",
    "APPLICATION/JSON",
    " application/json ;q",
  ])("accepts %s", (type) => {
    expect(isJsonMediaType(type)).toBe(true);
  });

  it.each([
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/json-patch+json",
    "application/jsonx",
    "",
  ])("refuses %s", (type) => {
    expect(isJsonMediaType(type)).toBe(false);
  });

  it("refuses a body with no Content-Type", () => {
    expect(isJsonMediaType(null)).toBe(false);
  });
});
