import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { untouchableDatabase } from "@/db/testing";
import { splitWrites, syncVisits, type SyncItem } from "@/server/visits/sync";

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
      { id: "u1", role: "member" },
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

    const results = await syncVisits(stub, [item, item, item], { id: "u1", role: "member" }, clock);
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

    const results = await syncVisits(stub, [item], { id: "u1", role: "member" }, clock);
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

    const [result] = await syncVisits(stub, [item], { id: "u1", role: "member" }, clock);
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

    const [result] = await syncVisits(stub, [item], { id: "u1", role: "member" }, clock);
    expect(result?.error?.message).not.toMatch(/hunter2/);
    expect(result?.error?.message).toBe("Could not save this record right now. Try again.");
  });
});

describe("a blank unit number", () => {
  it("is that item's own refusal, made before the database is asked anything", async () => {
    // Reached only by a caller that skips the contract, which refuses the batch.
    logged.mockReset();
    const [result] = await syncVisits(
      untouchableDatabase(),
      [{ ...item, unitNumber: " \t " }],
      { id: "u1", role: "member" },
      clock,
    );
    expect(result).toMatchObject({ id: item.id, status: "rejected", visit: null });
    expect(result?.error).toMatchObject({
      status: 400,
      code: "validation_failed",
      details: [{ path: "/unitNumber", message: "Must contain something other than spaces." }],
    });
    // A deliberate refusal, not a failure worth a log line.
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("splitting a batch's writes", () => {
  type Judged = Parameters<typeof splitWrites>[0][number];
  const caller = { id: "u1", role: "member" as const };
  const write = (sessionId: string) => ({
    item,
    memberId: "u1",
    caller,
    session: { id: sessionId, kind: "regular" as const, startedAt: new Date(0) },
    judgeList: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const fresh = (key: string, sessionId = "s1"): Judged => ({
    key,
    verdict: { kind: "new", write: write(sessionId) },
  });
  const amend = (key: string): Judged => ({ key, verdict: { kind: "amend", write: write("s1") } });
  const replay = (key: string): Judged => ({
    key,
    verdict: { kind: "answered", status: "unchanged" },
  });
  /* A run as its keys, an amend as its key. */
  const shape = (judged: Judged[]) =>
    splitWrites(judged).map((step) =>
      step.kind === "run" ? step.entries.map((entry) => entry.key) : step.key,
    );

  it("writes consecutive new records as one run, past replays between them", () => {
    expect(shape([fresh("a"), replay("b"), fresh("c"), replay("d")])).toEqual([["a", "c"]]);
  });

  it("writes an amend alone, in its place, and starts another run after it", () => {
    expect(shape([fresh("a"), amend("b"), amend("c"), fresh("d"), fresh("e")])).toEqual([
      ["a"],
      "b",
      "c",
      ["d", "e"],
    ]);
  });

  it("starts another run for a record in another session", () => {
    expect(shape([fresh("a", "s1"), fresh("b", "s2"), fresh("c", "s2")])).toEqual([
      ["a"],
      ["b", "c"],
    ]);
  });

  it("writes nothing for replays alone", () => {
    expect(shape([replay("a"), replay("b")])).toEqual([]);
  });
});
