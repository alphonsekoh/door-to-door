import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  ACTIVE_SESSION_CONSTRAINT,
  isActiveSessionClash,
  transitionSession,
} from "@/server/sessions/service";

describe("isActiveSessionClash", () => {
  it("recognises the constraint on the error itself", () => {
    expect(isActiveSessionClash({ constraint: ACTIVE_SESSION_CONSTRAINT })).toBe(true);
  });

  it("finds it on a wrapped cause", () => {
    // Drizzle wraps the driver error, so the constraint is never on top.
    expect(
      isActiveSessionClash(
        Object.assign(new Error("Failed query"), {
          cause: { constraint: ACTIVE_SESSION_CONSTRAINT },
        }),
      ),
    ).toBe(true);
  });

  it("finds it several causes deep", () => {
    expect(
      isActiveSessionClash({ cause: { cause: { constraint: ACTIVE_SESSION_CONSTRAINT } } }),
    ).toBe(true);
  });

  it.each([
    ["a different constraint", { constraint: "households_block_unit_unique" }],
    ["an error with no constraint", new Error("connection reset")],
    ["null", null],
    ["a string", "boom"],
    ["undefined", undefined],
  ])("does not claim %s", (_case, error) => {
    expect(isActiveSessionClash(error)).toBe(false);
  });
});

describe("transitionSession error handling", () => {
  it("rethrows an unrelated database failure rather than blaming the session", () => {
    /*
     * A connection reset must not be reported as "another session is active",
     * which would send an admin looking for a session that does not exist.
     */
    const draftRow = {
      id: "s1",
      title: "Outing",
      status: "draft",
      startedAt: null,
      endedAt: null,
      createdAt: new Date(),
      createdById: "u1",
      createdByName: "Admin",
      createdByImage: null,
    };

    const stub = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([draftRow]) }) }),
        }),
      }),
      update: () => ({
        set: () => ({ where: () => Promise.reject(new Error("connection reset")) }),
      }),
    } as unknown as Database;

    return expect(transitionSession(stub, "s1", "start")).rejects.toThrow("connection reset");
  });
});
