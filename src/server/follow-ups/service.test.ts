import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { ConflictError } from "@/server/http/errors";
import { createFollowUp, ONE_OPEN_SUGGESTION } from "@/server/follow-ups/service";

/* A database whose household lookup succeeds and whose insert fails with `failure`. */
function failingInsert(failure: Error): Database {
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "h1" }]) }) }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.reject(failure) }) }),
  } as unknown as Database;
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
    const clash = Object.assign(new Error("Failed query"), {
      cause: { constraint: ONE_OPEN_SUGGESTION },
    });
    await expect(
      createFollowUp(failingInsert(clash), input, { id: "u1", role: "admin" }),
    ).rejects.toMatchObject({ code: "follow_up_exists", status: 409 });
    await expect(
      createFollowUp(failingInsert(clash), input, { id: "u1", role: "admin" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
