import { beforeEach, describe, expect, it, vi } from "vitest";
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

const logged = vi.spyOn(console, "error");
let wallClock = Date.parse("2026-03-14T12:00:00.000Z");

describe("unexpected failures", () => {
  beforeEach(() => {
    // Each test starts outside the previous one's throttle window.
    wallClock += 60_000;
    vi.spyOn(Date, "now").mockReturnValue(wallClock);
    logged.mockReset();
    logged.mockImplementation(() => undefined);
  });

  it("logs the cause with the item id, but not the request, and not to the client", async () => {
    const cause = new Error("deadlock detected");
    const stub = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.reject(cause) }) }),
      }),
    } as unknown as Database;

    const [result] = await syncVisits(
      stub,
      [{ ...item, description: "private note" }],
      "u1",
      clock,
    );

    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain(item.id);
    expect(line).toContain("deadlock detected");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("private note");
    expect(result?.error?.message).not.toMatch(/deadlock/);
  });

  it("logs a batch failing on a dropped connection once, not once per item", async () => {
    const stub = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.reject(
                Object.assign(new Error("connect ECONNREFUSED 10.0.0.12:5432"), {
                  code: "ECONNREFUSED",
                }),
              ),
          }),
        }),
      }),
    } as unknown as Database;

    const results = await syncVisits(stub, [item, item, item], "u1", clock);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).not.toContain("10.0.0.12");
  });

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

  it("reports it as retryable, never as a conflict the queue would hold", async () => {
    const stub = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.reject(new Error("deadlock detected")) }),
        }),
      }),
    } as unknown as Database;

    const [result] = await syncVisits(stub, [item], "u1", clock);
    expect(result?.error?.code).toBe("internal_error");
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
    expect(result?.error?.message).toBe("Could not save this record right now. Try again.");
  });
});
