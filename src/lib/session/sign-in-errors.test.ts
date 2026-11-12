import { describe, expect, it } from "vitest";
import { GOOGLE_UNFINISHED, googleSignInMessage } from "@/lib/session/sign-in-errors";

const DOMAINS = ["gmail.com", "tjc.sg", "tjc.org"];

describe("googleSignInMessage", () => {
  it("says nothing when nothing went wrong", () => {
    expect(googleSignInMessage(null, DOMAINS)).toBeNull();
  });

  it("gives every refusal the one message, whoever has an account, naming the domains (D-15-1)", () => {
    expect(googleSignInMessage("AccessDenied", DOMAINS)).toBe(
      "That Google account can't sign in here. Use the email address your admin added. " +
        "Google sign-in works only for addresses at gmail.com, tjc.sg or tjc.org. " +
        "For any other address, sign in with your email and password.",
    );
  });

  it.each(["OAuthCallbackError", "Configuration", "OAuthAccountNotLinked", "", "<b>bold</b>"])(
    "gives anything else (%j) a message of its own, never the value",
    (error) => {
      expect(googleSignInMessage(error, DOMAINS)).toBe(GOOGLE_UNFINISHED);
    },
  );
});
