import { describe, expect, it } from "vitest";
import {
  GOOGLE_REFUSED,
  GOOGLE_UNFINISHED,
  googleSignInMessage,
} from "@/lib/session/sign-in-errors";

describe("googleSignInMessage", () => {
  it("says nothing when nothing went wrong", () => {
    expect(googleSignInMessage(null)).toBeNull();
  });

  it("gives every refusal the one message, whoever has an account (D-15-1)", () => {
    expect(googleSignInMessage("AccessDenied")).toBe(GOOGLE_REFUSED);
  });

  it.each(["OAuthCallbackError", "Configuration", "OAuthAccountNotLinked", "", "<b>bold</b>"])(
    "gives anything else (%j) a message of its own, never the value",
    (error) => {
      expect(googleSignInMessage(error)).toBe(GOOGLE_UNFINISHED);
    },
  );
});
