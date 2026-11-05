import { describe, expect, it, vi } from "vitest";
import { untouchableDatabase } from "@/db/testing";
import type { Database } from "@/db/client";
import { GOOGLE_NOT_SET_UP_MESSAGE, createUser } from "@/server/users/service";

describe("createUser error handling", () => {
  it("rethrows an unrelated database failure rather than calling it a duplicate", () => {
    /*
     * A connection reset reported as "that email already belongs to someone"
     * would have an admin hunting for an account that is not there.
     */
    const stub = {
      insert: () => ({
        values: () => ({ returning: () => Promise.reject(new Error("connection reset")) }),
      }),
    } as unknown as Database;

    return expect(
      createUser(stub, { email: "new@t.local", password: "password123" }, false),
    ).rejects.toThrow("connection reset");
  });

  it("refuses a weak password before touching the database", () => {
    // Nothing is written, so a rejected password leaves no half-made account.
    const insert = vi.fn();
    const stub = { insert } as unknown as Database;

    return expect(createUser(stub, { email: "new@t.local", password: "short" }, true))
      .rejects.toThrow(/at least 8 characters/)
      .then(() => {
        expect(insert).not.toHaveBeenCalled();
      });
  });

  it("refuses a Google-only account while Google sign-in is not set up, before touching the database (#14)", async () => {
    // Nobody could ever sign in as it.
    await expect(
      createUser(untouchableDatabase(), { email: "new@t.local" }, false),
    ).rejects.toMatchObject({ status: 409, code: "conflict", message: GOOGLE_NOT_SET_UP_MESSAGE });
  });
});
