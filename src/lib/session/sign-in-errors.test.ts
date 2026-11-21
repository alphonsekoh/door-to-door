import { describe, expect, it } from "vitest";
import { GOOGLE_UNFINISHED, googleSignInMessage } from "@/lib/session/sign-in-errors";

const DOMAINS = ["gmail.com", "tjc.sg", "tjc.org"];

describe("googleSignInMessage", () => {
  it("says nothing when nothing went wrong", () => {
    expect(googleSignInMessage(null, DOMAINS)).toBeNull();
  });

  it("gives every refusal the one message, naming the domains (#249)", () => {
    expect(googleSignInMessage("AccessDenied", DOMAINS)).toBe(
      "That Google account can't sign in here. Google sign-in is for " +
        "gmail.com, tjc.sg or tjc.org accounts; otherwise, use your email and password.",
    );
  });

  it.each(["OAuthCallbackError", "Configuration", "OAuthAccountNotLinked", "", "<b>bold</b>"])(
    "gives anything else (%j) a message of its own, never the value",
    (error) => {
      expect(googleSignInMessage(error, DOMAINS)).toBe(GOOGLE_UNFINISHED);
    },
  );
});
