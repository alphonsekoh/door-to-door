import { describe, expect, it } from "vitest";
import { waitingSentence } from "@/lib/follow-ups/waiting";

describe("waitingSentence", () => {
  it("names the suggester by first name", () => {
    expect(waitingSentence({ name: "Ben Tan", mine: false })).toBe(
      "Ben's suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
  });

  it("says Your to the suggester, whatever their name", () => {
    expect(waitingSentence({ name: "Ben Tan", mine: true })).toBe(
      "Your suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
  });

  it("says Someone's for a suggester with no name", () => {
    expect(waitingSentence({ name: null, mine: false })).toBe(
      "Someone's suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
    expect(waitingSentence({ name: "  ", mine: false })).toMatch(/^Someone's suggestion/);
  });
});
