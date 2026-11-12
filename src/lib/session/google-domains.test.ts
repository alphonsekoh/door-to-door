import { describe, expect, it } from "vitest";
import {
  emailDomain,
  inGoogleDomains,
  listDomains,
  outsideGoogleDomainsMessage,
} from "@/lib/session/google-domains";

const DOMAINS = ["gmail.com", "tjc.sg", "tjc.org"];

describe("emailDomain", () => {
  it("is what follows the last @, lower-cased", () => {
    expect(emailDomain("Alice@TJC.sg")).toBe("tjc.sg");
    expect(emailDomain('"a@b"@gmail.com')).toBe("gmail.com");
  });

  it("is empty for something with no @, so a bare domain never passes for an address", () => {
    expect(emailDomain("gmail.com")).toBe("");
    expect(inGoogleDomains("gmail.com", DOMAINS)).toBe(false);
  });
});

describe("inGoogleDomains", () => {
  it("takes an address at one of the domains, whatever its case", () => {
    expect(inGoogleDomains("ann@Gmail.com", DOMAINS)).toBe(true);
    expect(inGoogleDomains("ben@tjc.org", DOMAINS)).toBe(true);
  });

  it("takes no other domain, a subdomain or a lookalike included", () => {
    expect(inGoogleDomains("ann@example.com", DOMAINS)).toBe(false);
    expect(inGoogleDomains("ann@mail.tjc.sg", DOMAINS)).toBe(false);
    expect(inGoogleDomains("ann@googlemail.com", DOMAINS)).toBe(false);
  });
});

describe("listDomains", () => {
  it("reads as a list", () => {
    expect(listDomains(["gmail.com"])).toBe("gmail.com");
    expect(listDomains(["gmail.com", "tjc.sg"])).toBe("gmail.com or tjc.sg");
    expect(listDomains(DOMAINS)).toBe("gmail.com, tjc.sg or tjc.org");
  });
});

describe("outsideGoogleDomainsMessage", () => {
  it("names the domains, and says what is needed instead", () => {
    expect(outsideGoogleDomainsMessage(DOMAINS)).toBe(
      "Google sign-in works only for addresses at gmail.com, tjc.sg or tjc.org, so they need a password.",
    );
  });
});
