import { describe, expect, it, vi } from "vitest";
import { untouchableDatabase } from "@/db/testing";
import type { Database } from "@/db/client";
import { GOOGLE_NOT_SET_UP_MESSAGE } from "@/lib/session/google-domains";
import { createAccessRequest, createUser } from "@/server/users/service";

const DOMAINS = ["gmail.com", "tjc.sg", "tjc.org"];

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
      createUser(stub, { email: "new@t.local", password: "password123" }, null),
    ).rejects.toThrow("connection reset");
  });

  it("refuses a weak password before touching the database", () => {
    // Nothing is written, so a rejected password leaves no half-made account.
    const insert = vi.fn();
    const stub = { insert } as unknown as Database;

    return expect(createUser(stub, { email: "new@t.local", password: "short" }, DOMAINS))
      .rejects.toThrow(/at least 8 characters/)
      .then(() => {
        expect(insert).not.toHaveBeenCalled();
      });
  });

  it("refuses a Google-only account while Google sign-in is not set up, before touching the database (#14)", async () => {
    // Nobody could ever sign in as it.
    await expect(
      createUser(untouchableDatabase(), { email: "new@t.local" }, null),
    ).rejects.toMatchObject({ status: 409, code: "conflict", message: GOOGLE_NOT_SET_UP_MESSAGE });
  });

  it.each(["new@t.local", "new@mail.tjc.sg", "New@Example.COM"])(
    "refuses a Google-only account at %s, outside the domains Google signs in for, naming them",
    async (email) => {
      // Google would refuse every sign-in to it (owner, 2026-11-12).
      await expect(createUser(untouchableDatabase(), { email }, DOMAINS)).rejects.toMatchObject({
        status: 409,
        code: "conflict",
        message:
          "Google sign-in works only for addresses at gmail.com, tjc.sg or tjc.org, so they need a password.",
      });
    },
  );
});

describe("createAccessRequest error handling (#249)", () => {
  it("rethrows an unrelated database failure rather than refusing the sign-in as a race", () => {
    /* A taken address refuses the sign-in quietly; an outage must not read as one. */
    const stub = {
      insert: () => ({
        values: () => ({ returning: () => Promise.reject(new Error("connection reset")) }),
      }),
    } as unknown as Database;

    return expect(
      createAccessRequest(stub, { email: "pat@gmail.com", name: null }),
    ).rejects.toThrow("connection reset");
  });
});
