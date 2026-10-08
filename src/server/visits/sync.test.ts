import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { syncVisits, type SyncItem } from "@/server/visits/sync";

const clock = { now: new Date("2026-03-14T12:00:00.000Z"), toleranceMs: 300_000 };

const item: SyncItem = {
  id: "01960000-0000-7000-8000-000000000001",
  blockId: "b1",
  unitNumber: "#05-123",
  interestLevel: "low",
  clientCreatedAt: "2026-03-14T10:00:00.000Z",
  updatedAt: "2026-03-14T10:00:00.000Z",
};

describe("unexpected failures", () => {
  it("rejects the item rather than losing the rest of the batch", async () => {
    /*
     * A connection reset mid-flush must not throw away the items either side
     * of it - the member has already knocked on those doors.
     */
    const stub = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.reject(new Error("connection reset")) }),
        }),
      }),
    } as unknown as Database;

    const results = await syncVisits(stub, [item], "u1", clock);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("rejected");
  });

  it("does not leak the internal message to the client", async () => {
    const stub = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.reject(new Error("password=hunter2 host=internal")),
          }),
        }),
      }),
    } as unknown as Database;

    const [result] = await syncVisits(stub, [item], "u1", clock);
    expect(result?.error?.message).not.toMatch(/hunter2/);
    expect(result?.error?.message).toBe("Could not save.");
  });
});
