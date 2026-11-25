import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { untouchableDatabase } from "@/db/testing";
import { ConflictError } from "@/server/http/errors";
import { createFollowUp, ONE_OPEN_SUGGESTION, updateFollowUp } from "@/server/follow-ups/service";

/* A database whose household lock finds the household, which finds no open
   note, and whose insert fails with `failure`. */
function failingInsert(failure: Error): Database {
  const fake = {
    transaction: (run: (tx: unknown) => Promise<unknown>) => run(fake),
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => Promise.resolve([{ id: "h1", erasedAt: null }]),
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.reject(failure) }) }),
  };
  return fake as unknown as Database;
}

describe("createFollowUp", () => {
  const input = { householdId: "h1", note: "Bring the flyer" };

  it("rethrows an unrelated database failure rather than calling it a duplicate", async () => {
    // A dropped connection must not tell a member someone already suggested the door.
    const reset = new Error("connection reset");
    await expect(
      createFollowUp(failingInsert(reset), input, { id: "u1", role: "admin" }),
    ).rejects.toBe(reset);
  });

  it("reads the one-pending-suggestion constraint as follow_up_exists", async () => {
    // A member, whose note is a suggestion: only a suggestion can hit that index.
    const clash = Object.assign(new Error("Failed query"), {
      cause: { constraint: ONE_OPEN_SUGGESTION },
    });
    await expect(
      createFollowUp(failingInsert(clash), input, { id: "u1", role: "member" }),
    ).rejects.toMatchObject({ code: "follow_up_exists", status: 409 });
    await expect(
      createFollowUp(failingInsert(clash), input, { id: "u1", role: "member" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("a blank note", () => {
  const untouchable = untouchableDatabase();
  const blank = { path: "/note", message: "Must contain something other than spaces." };

  it("is refused before a new note's transaction opens", async () => {
    await expect(
      createFollowUp(
        untouchable,
        { householdId: "h1", note: " \n\t " },
        { id: "u1", role: "admin" },
      ),
    ).rejects.toMatchObject({ status: 400, code: "validation_failed", details: [blank] });
  });

  it("is refused before an edited note is read or locked", async () => {
    await expect(
      updateFollowUp(untouchable, "f1", { note: "   " }, { id: "u1", role: "member" }),
    ).rejects.toMatchObject({ status: 400, code: "validation_failed", details: [blank] });
  });
});
