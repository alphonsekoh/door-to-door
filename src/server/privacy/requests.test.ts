import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { untouchableDatabase } from "@/db/testing";
import { createErasureRequest } from "@/server/privacy/requests";

const clock = { now: new Date("2026-11-25T10:00:00.000Z"), toleranceMs: 0 };

describe("createErasureRequest", () => {
  it("rethrows a failure that is not the one-open-request rule, rather than calling it a duplicate", async () => {
    // A dropped connection must not answer with some other request.
    const reset = new Error("connection reset");
    const fake = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ id: "u1" }]),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.reject(reset) }) }),
    } as unknown as Database;

    await expect(
      createErasureRequest(fake, { kind: "account", id: "u1" }, { id: "a1", role: "admin" }, clock),
    ).rejects.toBe(reset);
  });

  it("refuses a member naming an account before it reads anything", async () => {
    await expect(
      createErasureRequest(
        untouchableDatabase(),
        { kind: "account", id: "u1" },
        { id: "m1", role: "member" },
        clock,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a day in the future before it reads anything", async () => {
    await expect(
      createErasureRequest(
        untouchableDatabase(),
        { kind: "household", id: "h1", requestedAt: "2026-11-26T10:00:00.000Z" },
        { id: "m1", role: "member" },
        clock,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
