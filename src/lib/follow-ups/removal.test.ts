import { describe, expect, it } from "vitest";
import { reasonNote, reasonProblem, removalCopy } from "@/lib/follow-ups/removal";

const ANN = { id: "ann", name: "Ann Lee", image: null };

describe("removalCopy", () => {
  it("has an admin dismiss a member's suggestion, telling the member why", () => {
    expect(removalCopy({ status: "suggested", author: ANN }, true, "admin")).toEqual({
      kind: "dismiss",
      title: "Dismiss this suggestion?",
      body: "Ann will be told it was not added, with your reason.",
      label: "Why not add it?",
      placeholder: "For example: we visited last week",
      button: "Dismiss suggestion",
      readers: "Ann and admins will see it.",
    });
  });

  it("has an admin remove a listed note, telling its author why", () => {
    expect(removalCopy({ status: "listed", author: ANN }, true, "admin")).toEqual({
      kind: "remove",
      title: "Remove from the follow-up list?",
      body: "It leaves the list and every follow-up session's list. Ann will be told, with your reason.",
      label: "Why take it off the list?",
      placeholder: "For example: the family has moved",
      button: "Remove from list",
      readers: "Ann and admins will see it.",
    });
  });

  it("tells an admin removing their own note that only admins will read why", () => {
    const own = removalCopy({ status: "listed", author: ANN }, true, "ann");
    expect(own.body).toBe(
      "It leaves the list and every follow-up session's list. Admins can still see it under Dismissed.",
    );
    expect(own.readers).toBe("Admins will see it under Dismissed.");
    expect(removalCopy({ status: "suggested", author: ANN }, true, "ann").body).toBe(
      "Admins can still see it under Dismissed.",
    );
  });

  it("has a member withdraw their own suggestion", () => {
    expect(removalCopy({ status: "suggested", author: ANN }, false, "ann")).toEqual({
      kind: "withdraw",
      title: "Withdraw your suggestion?",
      body: "Admins will no longer see it for review.",
      label: "Why withdraw it?",
      placeholder: "For example: I picked the wrong unit",
      button: "Withdraw suggestion",
      readers: "Admins will see it under Dismissed.",
    });
  });

  it("treats a viewer not yet known as someone else", () => {
    expect(removalCopy({ status: "suggested", author: ANN }, true, undefined).readers).toBe(
      "Ann and admins will see it.",
    );
  });
});

describe("reasonProblem", () => {
  it("needs something other than spaces, and no more than 500 characters", () => {
    expect(reasonProblem("")).toBe("blank");
    expect(reasonProblem("   ")).toBe("blank");
    expect(reasonProblem(` ${"x".repeat(500)} `)).toBeNull();
    expect(reasonProblem("x".repeat(501))).toBe("too_long");
  });
});

describe("reasonNote", () => {
  it("asks for a reason, then says who will read it, or that it is too long", () => {
    const readers = "Ann and admins will see it.";
    expect(reasonNote("blank", readers)).toBe(
      "Write a reason to continue. Ann and admins will see it.",
    );
    expect(reasonNote(null, readers)).toBe(readers);
    expect(reasonNote("too_long", readers)).toBe("Keep the reason to 500 characters.");
  });
});
