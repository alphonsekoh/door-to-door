import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createUser } from "@/server/users/service";

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
      createUser(stub, { email: "new@t.local", password: "password123" }),
    ).rejects.toThrow("connection reset");
  });

  it("refuses a weak password before touching the database", () => {
    // Nothing is written, so a rejected password leaves no half-made account.
    const insert = vi.fn();
    const stub = { insert } as unknown as Database;

    return expect(createUser(stub, { email: "new@t.local", password: "short" }))
      .rejects.toThrow(/at least 8 characters/)
      .then(() => {
        expect(insert).not.toHaveBeenCalled();
      });
  });
});
