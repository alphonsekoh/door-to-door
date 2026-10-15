import { describe, expect, it, vi } from "vitest";
import type { VisitSyncItem, VisitSyncResult } from "@/generated/types.gen";
import { INITIAL_STATE } from "@/lib/sync/classify";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { BATCH_SIZE, dueRecords, flushOnce } from "@/lib/sync/engine";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type { QueuedVisit, SendOutcome } from "@/lib/sync/types";
import { uuidv7 } from "@/lib/uuid";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

function saved(ownerId: string, at: number, unit = "#05-01"): QueuedVisit {
  return buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber: unit,
      interestLevel: "high",
      description: "",
      name: "",
      contact: "",
      religion: "",
      sessionId: null,
    },
    ownerId,
    at,
    (now) => uuidv7(now),
  );
}

const applied = (items: VisitSyncItem[]): SendOutcome => ({
  kind: "ok",
  results: items.map((item): VisitSyncResult => ({ id: item.id, status: "applied", visit: null })),
});

const deps = (send: (items: VisitSyncItem[]) => Promise<SendOutcome>) => ({
  send: vi.fn(send),
  now: () => NOW,
  random: () => 0.5,
});

describe("flushOnce", () => {
  it("sends the owner's due records and marks them sent", async () => {
    const queue = createMemoryQueue();
    const first = saved("ann", NOW - 2);
    await queue.put(first);
    const d = deps((items) => Promise.resolve(applied(items)));

    const result = await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(result.synced).toEqual([first.id]);
    expect((await queue.get(first.id))?.state).toBe("synced");
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("never reads or sends another member's records (D-33-1)", async () => {
    const queue = createMemoryQueue();
    const mine = saved("ann", NOW - 2);
    const theirs = saved("ben", NOW - 3);
    await queue.putMany([mine, theirs]);
    const d = deps((items) => Promise.resolve(applied(items)));

    await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(d.send.mock.calls.flatMap(([items]) => items.map((item) => item.id))).toEqual([mine.id]);
    expect(await queue.get(theirs.id)).toEqual(theirs);
  });

  it("sends the oldest first", async () => {
    const queue = createMemoryQueue();
    const later = saved("ann", NOW - 1, "#05-02");
    const earlier = saved("ann", NOW - 5, "#05-01");
    await queue.putMany([later, earlier]);
    const d = deps((items) => Promise.resolve(applied(items)));

    await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(d.send.mock.calls[0]?.[0].map((item) => item.id)).toEqual([earlier.id, later.id]);
  });

  it("splits more than a hundred records into batches", async () => {
    const queue = createMemoryQueue();
    await queue.putMany(
      Array.from({ length: BATCH_SIZE + 5 }, (_, i) => saved("ann", NOW - 500 + i)),
    );
    const d = deps((items) => Promise.resolve(applied(items)));

    const result = await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(d.send.mock.calls.map(([items]) => items.length)).toEqual([BATCH_SIZE, 5]);
    expect(result.synced).toHaveLength(BATCH_SIZE + 5);
  });

  it("matches results by id, not by position", async () => {
    const queue = createMemoryQueue();
    const a = saved("ann", NOW - 2, "#05-01");
    const b = saved("ann", NOW - 1, "#05-02");
    await queue.putMany([a, b]);
    const d = deps(() =>
      Promise.resolve({
        kind: "ok",
        results: [
          { id: b.id, status: "applied" },
          {
            id: a.id,
            status: "rejected",
            error: { error: { code: "conflict", message: "x" } },
          },
        ],
      }),
    );

    await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect((await queue.get(a.id))?.state).toBe("held");
    expect((await queue.get(b.id))?.state).toBe("synced");
  });

  it("sends each record at most once per run, leaving a retry to the next trigger", async () => {
    const queue = createMemoryQueue();
    const record = saved("ann", NOW - 2);
    await queue.put(record);
    // A delay of zero would make it due again at once.
    const d = {
      ...deps(() => Promise.resolve({ kind: "ok", results: [] } as SendOutcome)),
      random: () => 0,
    };

    const result = await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(d.send).toHaveBeenCalledTimes(1);
    expect(result.synced).toEqual([]);
    expect(await queue.get(record.id)).toMatchObject({ state: "failed", attempts: 1 });
  });

  it("produces one server row however often the same record is replayed", async () => {
    // The server's side of idempotency, modelled: a second sight of an id is
    // `unchanged`. The client must treat that as sent, not as a new record.
    const stored = new Set<string>();
    const server = (items: VisitSyncItem[]): Promise<SendOutcome> =>
      Promise.resolve({
        kind: "ok",
        results: items.map((item) => {
          const seen = stored.has(item.id);
          stored.add(item.id);
          return { id: item.id, status: seen ? "unchanged" : "applied" };
        }),
      });
    const queue = createMemoryQueue();
    const record = saved("ann", NOW - 2);
    await queue.put(record);
    // Two tabs racing: both read the record as due before either writes.
    const [one, two] = await Promise.all([
      flushOnce(queue, "ann", INITIAL_STATE, deps(server)),
      flushOnce(queue, "ann", INITIAL_STATE, deps(server)),
    ]);

    expect(stored.size).toBe(1);
    expect([...one.synced, ...two.synced]).toEqual([record.id, record.id]);
    expect((await queue.get(record.id))?.state).toBe("synced");
  });

  it("stops at a wait the server imposed and touches nothing", async () => {
    const queue = createMemoryQueue();
    const record = saved("ann", NOW - 2);
    await queue.put(record);
    const d = deps(() =>
      Promise.resolve({ kind: "http", status: 403, code: "account_deactivated" }),
    );

    const result = await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(result.state.block?.reason).toBe("deactivated");
    expect(await queue.get(record.id)).toEqual(record);
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing while a wait lasts", async () => {
    const queue = createMemoryQueue();
    await queue.put(saved("ann", NOW - 2));
    const d = deps((items) => Promise.resolve(applied(items)));
    const blocked = { ...INITIAL_STATE, block: { reason: "clock" as const, until: NOW + 1 } };

    const result = await flushOnce(queue, "ann", blocked, d);

    expect(d.send).not.toHaveBeenCalled();
    expect(result.state).toEqual(blocked);
  });

  it("finds the one record that breaks a batch and sends the rest", async () => {
    const queue = createMemoryQueue();
    const good = saved("ann", NOW - 3, "#05-01");
    const poison = saved("ann", NOW - 2, "#05-02");
    const alsoGood = saved("ann", NOW - 1, "#05-03");
    await queue.putMany([good, poison, alsoGood]);
    const d = deps((items) =>
      Promise.resolve(
        items.some((item) => item.id === poison.id)
          ? { kind: "http" as const, status: 400, code: "validation_failed" }
          : applied(items),
      ),
    );

    const result = await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(d.send.mock.calls.map(([items]) => items.length)).toEqual([3, 1, 1, 1]);
    expect(result.synced.sort()).toEqual([good.id, alsoGood.id].sort());
    expect(await queue.get(poison.id)).toMatchObject({
      state: "quarantined",
      lastError: { code: "invalid" },
    });
    // Nothing left due, so the next run goes back to whole batches.
    expect(result.state.isolation).toBe(false);
  });

  it("charges server failures to a record only once it is sent alone", async () => {
    const queue = createMemoryQueue();
    const record = saved("ann", NOW - 2);
    await queue.put(record);
    let now = NOW;
    const d = {
      send: vi.fn(() =>
        Promise.resolve<SendOutcome>({ kind: "http", status: 500, code: "internal_error" }),
      ),
      now: () => now,
      random: () => 0.5,
    };

    let state = INITIAL_STATE;
    for (let run = 0; run < 3; run += 1) {
      state = (await flushOnce(queue, "ann", state, d)).state;
      now += 10 * 60_000;
    }
    expect(state.isolation).toBe(true);
    expect((await queue.get(record.id))?.attempts).toBe(0);

    state = (await flushOnce(queue, "ann", state, d)).state;
    expect(await queue.get(record.id)).toMatchObject({ state: "failed", attempts: 1 });
  });
});

describe("flushOnce during a database outage (D-87-2)", () => {
  const internalError = (id: string): VisitSyncResult => ({
    id,
    status: "rejected",
    error: { error: { code: "internal_error", message: "Internal error" } },
  });
  const outage = (items: VisitSyncItem[]): SendOutcome => ({
    kind: "ok",
    results: items.map((item) => internalError(item.id)),
  });

  it("charges no record while every one in the batch fails together", async () => {
    const queue = createMemoryQueue();
    const records = [saved("ann", NOW - 3, "#05-01"), saved("ann", NOW - 2, "#05-02")];
    await queue.putMany(records);
    let now = NOW;
    const d = {
      send: vi.fn((items: VisitSyncItem[]) => Promise.resolve(outage(items))),
      now: () => now,
      random: () => 0.5,
    };

    // Far more runs than the cap: an outage alone must never stop a record.
    let state = INITIAL_STATE;
    for (let run = 0; run < 2; run += 1) {
      state = (await flushOnce(queue, "ann", state, d)).state;
      now += 10 * 60_000;
    }
    expect(state).toMatchObject({ serverStreak: 2, isolation: false, block: { reason: "server" } });
    for (const record of records) {
      expect(await queue.get(record.id)).toMatchObject({ state: "queued", attempts: 0 });
    }

    // The third switches to one at a time; from then on only the record sent
    // alone is charged, once per run, and the queue backs off between runs.
    state = (await flushOnce(queue, "ann", state, d)).state;
    expect(state.isolation).toBe(true);
    now += 10 * 60_000;
    state = (await flushOnce(queue, "ann", state, d)).state;
    expect(d.send.mock.calls.at(-1)?.[0]).toHaveLength(1);
    const charged = await Promise.all(records.map((r) => queue.get(r.id)));
    expect(charged.map((r) => r?.attempts)).toEqual([1, 0]);
    expect(state.block?.reason).toBe("server");
  });

  it("still charges a record that fails while the rest of its batch goes in", async () => {
    const queue = createMemoryQueue();
    const good = saved("ann", NOW - 3, "#05-01");
    const poison = saved("ann", NOW - 2, "#05-02");
    await queue.putMany([good, poison]);
    const d = deps((items) =>
      Promise.resolve({
        kind: "ok" as const,
        results: items.map((item) =>
          item.id === poison.id
            ? internalError(item.id)
            : { id: item.id, status: "applied" as const, visit: null },
        ),
      }),
    );

    const result = await flushOnce(queue, "ann", INITIAL_STATE, d);

    expect(result.synced).toEqual([good.id]);
    expect(await queue.get(poison.id)).toMatchObject({ state: "failed", attempts: 1 });
  });
});

describe("dueRecords", () => {
  it("breaks a tie in save time by id, so the order is stable", () => {
    const a = { ...saved("ann", NOW), id: "a" };
    const b = { ...saved("ann", NOW), id: "b" };
    expect(dueRecords([b, a], NOW).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
