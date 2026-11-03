import { describe, expect, it } from "vitest";
import { CSP_HEADER, securityHeaders } from "@/server/http/security-headers";

const asMap = (development: boolean) =>
  new Map(securityHeaders({ development }).map(({ key, value }) => [key, value]));

/* The policy as directive name -> sources, so each is checked on its own. */
function directives(development: boolean): Map<string, string[]> {
  const policy = asMap(development).get(CSP_HEADER) ?? "";
  return new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("the Content Security Policy", () => {
  it("only reports for now, until a real-device pass shows no violations (#146)", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only");
    expect(asMap(false).has("Content-Security-Policy")).toBe(false);
  });

  it("allows only this origin, plus what Next and the noise texture need", () => {
    expect(Object.fromEntries(directives(false))).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "worker-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
    });
  });

  it("lets scripts eval only under next dev", () => {
    expect(directives(true).get("script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
    ]);
    expect(directives(false).get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("differs between the modes in script-src alone", () => {
    const dev = directives(true);
    dev.delete("script-src");
    const prod = directives(false);
    prod.delete("script-src");
    expect(dev).toEqual(prod);
  });

  it.each([true, false])(
    "neither upgrades requests nor reports anywhere (development: %s)",
    (development) => {
      // Upgrading would break plain-http runs once enforced, and a report
      // endpoint would be an unauthenticated write.
      const names = [...directives(development).keys()];
      expect(names).not.toContain("upgrade-insecure-requests");
      expect(names).not.toContain("report-uri");
      expect(names).not.toContain("report-to");
    },
  );
});

describe("the other headers", () => {
  it.each([true, false])("are the same in both modes (development: %s)", (development) => {
    const headers = asMap(development);
    headers.delete(CSP_HEADER);
    expect(Object.fromEntries(headers)).toEqual({
      "Strict-Transport-Security": "max-age=63072000",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "X-Frame-Options": "DENY",
    });
  });

  it("keeps HSTS to this host, without preload, until the domain is chosen (#146)", () => {
    const hsts = asMap(false).get("Strict-Transport-Security");
    expect(hsts).not.toMatch(/includeSubDomains/i);
    expect(hsts).not.toMatch(/preload/i);
  });
});
