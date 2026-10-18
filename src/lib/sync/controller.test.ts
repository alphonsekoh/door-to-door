import { describe, expect, it, vi } from "vitest";
import type { VisitSyncItem } from "@/generated/types.gen";
import { PROBE_MS, RATE_LIMIT_MS } from "@/lib/sync/backoff";
import {
  type ControllerDeps,
  SYNCED_KEPT_MS,
  type SyncSnapshot,
  createSyncController,
} from "@/lib/sync/controller";
import { type VisitDraft, buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type { QueuedVisit, SendOutcome } from "@/lib/sync/types";

const START = Date.parse("2026-10-15T10:00:00.000Z");

const draft = (unitNumber = "#05-01"): VisitDraft => ({
  blockId: "0190a000-0000-7000-8000-0000000000bb",
  unitNumber,
  interestLevel: "high",
  description: "",
  name: "",
  contact: "",
  religion: "",
  sessionId: "0190a000-0000-7000-8000-0000000000cc",
});

const applied = (items: VisitSyncItem[]): SendOutcome => ({
  kind: "ok",
  results: items.map((item) => ({ id: item.id, status: "applied" })),
});

/* A controller over a memory queue, a hand-cranked clock and timers that only
   fire when the test says so. */
function harness(
  options: {
    queue?: ReturnType<typeof createMemoryQueue>;
    send?: (items: VisitSyncItem[]) => Promise<SendOutcome>;
    overrides?: Partial<ControllerDeps>;
  } = {},
) {
  const queue = options.queue ?? createMemoryQueue();
  let now = START;
  const timers: { callback: () => void; at: number; id: number }[] = [];
  let nextTimer = 0;
  const snapshots: SyncSnapshot[] = [];
  const send = vi.fn(options.send ?? ((items: VisitSyncItem[]) => Promise.resolve(applied(items))));

  const controller = createSyncController({
    queue,
    ownerId: "ann",
    send,
    now: () => now,
    random: () => 0.5,
    setTimer: (callback, ms) => {
      nextTimer += 1;
      timers.push({ callback, at: now + ms, id: nextTimer });
      return nextTimer;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index !== -1) timers.splice(index, 1);
    },
    onChange: (snapshot) => snapshots.push(snapshot),
    ...options.overrides,
  });

  return {
    queue,
    controller,
    send,
    snapshots,
    timers,
    last: () => snapshots.at(-1),
    advance: (ms: number) => {
      now += ms;
    },
    /* Fires whatever timer is now due and waits for its run. */
    async tick(ms: number) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      for (const timer of due) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      await controller.flush();
    },
  };
}

function stored(ownerId: string, at: number, overrides: Partial<QueuedVisit> = {}): QueuedVisit {
  return { ...buildQueuedVisit(draft(), ownerId, at), ...overrides };
}

describe("createSyncController", () => {
  it("saves to the queue before anything is sent, then sends it", async () => {
    let seenBeforeSend: QueuedVisit[] = [];
    const queue = createMemoryQueue();
    const h = harness({
      queue,
      send: async (items) => {
        seenBeforeSend = await queue.listByOwner("ann");
        return applied(items);
      },
    });

    const record = await h.controller.enqueue(draft());
    await h.controller.flush();

    expect(seenBeforeSend.map((r) => r.id)).toEqual([record.id]);
    expect((await queue.get(record.id))?.state).toBe("synced");
    expect(h.last()?.records.map((r) => r.state)).toEqual(["synced"]);
  });

  it("shows a just-saved record as sending, and only that one", async () => {
    let release: (outcome: SendOutcome) => void = () => undefined;
    const h = harness({ send: () => new Promise((resolve) => (release = resolve)) });

    const record = await h.controller.enqueue(draft());
    expect(h.last()?.inFlight.has(record.id)).toBe(true);
    expect(h.last()?.justSaved.has(record.id)).toBe(true);

    release({ kind: "network" });
    await h.controller.flush();
    expect(h.last()?.inFlight.size).toBe(0);
    expect(h.last()?.justSaved.size).toBe(0);
    expect(h.last()?.block?.reason).toBe("offline");
  });

  it("shows a record saved behind a stalled send as waiting, not sending", async () => {
    let release: (outcome: SendOutcome) => void = () => undefined;
    const h = harness({ send: () => new Promise((resolve) => (release = resolve)) });

    const first = await h.controller.enqueue(draft("#05-01"));
    const second = await h.controller.enqueue(draft("#05-02"));
    // Only the first is in the request that is out; the bar counts the second.
    expect(h.last()?.inFlight).toEqual(new Set([first.id]));
    expect(h.last()?.justSaved).toEqual(new Set([first.id]));
    expect(h.last()?.justSaved.has(second.id)).toBe(false);

    release({ kind: "network" });
    await h.controller.flush();
  });

  it("stops counting a just-saved record as sending when the batch leaves it out", async () => {
    let release: (outcome: SendOutcome) => void = () => undefined;
    const older = Array.from({ length: 100 }, (_, i) => stored("ann", START - 1_000 + i));
    const h = harness({
      queue: createMemoryQueue(older),
      send: () => new Promise((resolve) => (release = resolve)),
    });

    const record = await h.controller.enqueue(draft());
    await vi.waitFor(() => {
      expect(h.send).toHaveBeenCalledTimes(1);
    });
    expect(h.last()?.inFlight.has(record.id)).toBe(false);
    expect(h.last()?.justSaved.has(record.id)).toBe(false);

    release({ kind: "network" });
    await h.controller.flush();
  });

  it("asks once for persistent storage and ignores the answer", async () => {
    const persist = vi.fn().mockRejectedValue(new Error("no"));
    const h = harness({ overrides: { persist } });
    await h.controller.enqueue(draft("#05-01"));
    await h.controller.enqueue(draft("#05-02"));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("passes on a failed write so the form can save another way", async () => {
    const queue = createMemoryQueue();
    queue.put = () => Promise.reject(new DOMException("full", "QuotaExceededError"));
    const h = harness({ queue });
    await expect(h.controller.enqueue(draft())).rejects.toThrow("full");
    expect(h.send).not.toHaveBeenCalled();
    // Nothing half-saved is left showing as sending or waiting.
    await h.controller.flush();
    expect(h.last()).toMatchObject({ records: [], inFlight: new Set(), justSaved: new Set() });
  });

  it("purges records sent more than a day ago on start, then sends what is due", async () => {
    const old = stored("ann", START - 1, { state: "synced", syncedAt: START - SYNCED_KEPT_MS - 1 });
    const recent = stored("ann", START - 2, { state: "synced", syncedAt: START - 1 });
    const waiting = stored("ann", START - 3);
    const h = harness({ queue: createMemoryQueue([old, recent, waiting]) });

    await h.controller.start();

    expect(h.queue.raw.has(old.id)).toBe(false);
    expect(h.queue.raw.has(recent.id)).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect((await h.queue.get(waiting.id))?.state).toBe("synced");
  });

  it("still starts when the purge fails", async () => {
    const queue = createMemoryQueue([stored("ann", START - 3)]);
    queue.deleteSyncedBefore = () => Promise.reject(new Error("broken"));
    const h = harness({ queue });
    await h.controller.start();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("does not count records already sent at start as newly sent", async () => {
    const h = harness({
      queue: createMemoryQueue([
        stored("ann", START - 1, { state: "synced", syncedAt: START - 1 }),
      ]),
    });
    await h.controller.start();
    expect(h.last()?.syncedVersion).toBe(0);
  });

  it("bumps the synced version when a record reaches the server", async () => {
    const h = harness();
    await h.controller.start();
    await h.controller.enqueue(draft());
    await h.controller.flush();
    expect(h.last()?.syncedVersion).toBe(1);
  });

  it("runs once more for a trigger that arrives mid-run, rather than dropping it", async () => {
    let release: (outcome: SendOutcome) => void = () => undefined;
    const sendCalls: string[][] = [];
    const h = harness({
      send: (items) => {
        sendCalls.push(items.map((i) => i.unitNumber));
        return sendCalls.length === 1
          ? new Promise((resolve) => (release = resolve))
          : Promise.resolve(applied(items));
      },
    });

    const first = await h.controller.enqueue(draft("#05-01"));
    await h.controller.enqueue(draft("#05-02"));
    release(applied([first.item]));
    await h.controller.flush();

    expect(sendCalls).toEqual([["#05-01"], ["#05-02"]]);
  });

  it("holds the sending lock for the whole run", async () => {
    const order: string[] = [];
    const exclusive = vi.fn(async (run: () => Promise<void>) => {
      order.push("lock");
      await run();
      order.push("unlock");
    });
    const h = harness({
      overrides: { exclusive },
      send: (items) => {
        order.push("send");
        return Promise.resolve(applied(items));
      },
    });
    await h.controller.enqueue(draft());
    await h.controller.flush();
    // The save's own trigger and this one: each run takes the lock afresh.
    expect(order.join(" ")).toMatch(/^lock send unlock( lock unlock)*$/);
  });

  it("tells other tabs whenever it writes", async () => {
    const announce = vi.fn();
    const h = harness({ overrides: { announce } });
    await h.controller.enqueue(draft());
    await h.controller.flush();
    expect(announce.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("re-reads when another tab says the queue changed", async () => {
    const h = harness();
    await h.controller.start();
    await h.queue.put(stored("ann", START, { state: "held", nextAttemptAt: null }));
    await h.controller.refresh();
    expect(h.last()?.records).toHaveLength(1);
  });

  it("keeps what is on screen when the queue cannot be read", async () => {
    const queue = createMemoryQueue([stored("ann", START, { state: "held", nextAttemptAt: null })]);
    const h = harness({ queue });
    await h.controller.start();
    queue.listByOwner = () => Promise.reject(new Error("gone"));
    await h.controller.refresh();
    expect(h.last()?.records).toHaveLength(1);
  });

  it("survives a run whose writes fail, and is ready for the next trigger", async () => {
    const queue = createMemoryQueue([stored("ann", START - 1)]);
    queue.putMany = () => Promise.reject(new Error("disk"));
    const h = harness({ queue });
    await h.controller.start();
    expect(h.last()?.inFlight.size).toBe(0);
    await h.controller.flush();
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  describe("after storage fails", () => {
    it("backs off from five seconds rather than spinning on a closed database", async () => {
      const queue = createMemoryQueue([stored("ann", START - 1)]);
      const h = harness({ queue });
      await h.controller.refresh();
      // The connection has gone (another tab upgraded): every read now fails.
      queue.listByOwner = () => Promise.reject(new DOMException("closed", "InvalidStateError"));

      await h.controller.flush();
      expect(h.timers.map((t) => t.at)).toEqual([START + 5_000]);

      await h.tick(5_000);
      expect(h.timers.map((t) => t.at)).toEqual([START + 5_000 + 10_000]);
      expect(h.send).not.toHaveBeenCalled();
    });

    it("does not re-send a batch in a tight loop when the disk is full", async () => {
      const queue = createMemoryQueue([stored("ann", START - 1)]);
      const putMany = queue.putMany;
      queue.putMany = () => Promise.reject(new DOMException("full", "QuotaExceededError"));
      const h = harness({ queue });

      await h.controller.start();
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.timers.map((t) => t.at)).toEqual([START + 5_000]);

      // Disk freed: the timer replays the batch and this time it is written.
      queue.putMany = putMany;
      await h.tick(5_000);
      expect(h.send).toHaveBeenCalledTimes(2);
      expect(h.last()?.records.map((r) => r.state)).toEqual(["synced"]);
      expect(h.timers).toEqual([]);
    });

    it("still runs at once on a trigger, and drops the storage wait once a run works", async () => {
      let broken = false;
      const queue = createMemoryQueue([stored("ann", START - 1)]);
      const listByOwner = queue.listByOwner;
      queue.listByOwner = (owner) =>
        broken ? Promise.reject(new Error("closed")) : listByOwner(owner);
      const h = harness({ queue, send: () => Promise.resolve({ kind: "network" }) });
      await h.controller.refresh();

      broken = true;
      await h.controller.flush();
      await h.controller.flush();
      expect(h.timers.map((t) => t.at)).toEqual([START + 10_000]);

      broken = false;
      await h.controller.wake();
      expect(h.send).toHaveBeenCalledTimes(1);
      // Only the no-signal backoff (2.5 s at random 0.5) is left.
      expect(h.timers.map((t) => t.at)).toEqual([START + 2_500]);
    });
  });

  describe("timing", () => {
    it("tries again when a record's backoff runs out", async () => {
      let fail = true;
      const h = harness({
        send: (items) =>
          Promise.resolve<SendOutcome>(
            fail
              ? {
                  kind: "ok",
                  results: items.map((i) => ({
                    id: i.id,
                    status: "rejected",
                    error: { error: { code: "internal_error", message: "" } },
                  })),
                }
              : applied(items),
          ),
      });
      await h.controller.enqueue(draft());
      await h.controller.flush();
      expect(h.timers.map((t) => t.at)).toEqual([START + 2_500]);

      fail = false;
      await h.tick(2_500);
      expect(h.send).toHaveBeenCalledTimes(2);
      expect(h.last()?.records[0]?.state).toBe("synced");
      expect(h.timers).toEqual([]);
    });

    it("waits out a whole-queue wait before a due record", async () => {
      const h = harness({
        send: () => Promise.resolve({ kind: "http", status: 429, code: "rate_limited" }),
      });
      await h.controller.enqueue(draft());
      await h.controller.flush();
      expect(h.timers.map((t) => t.at)).toEqual([START + RATE_LIMIT_MS]);
    });

    it("sets no timer after a sign-out, which only a page load undoes", async () => {
      const h = harness({
        send: () => Promise.resolve({ kind: "http", status: 401, code: "unauthenticated" }),
      });
      await h.controller.enqueue(draft());
      await h.controller.flush();
      expect(h.timers).toEqual([]);
    });

    it("sets no timer for records that wait for a tap", async () => {
      const h = harness({
        queue: createMemoryQueue([stored("ann", START, { state: "held", nextAttemptAt: null })]),
      });
      await h.controller.start();
      expect(h.timers).toEqual([]);
    });

    it("looks again at an ended outing every five minutes", async () => {
      const h = harness({
        queue: createMemoryQueue([
          stored("ann", START, { state: "held", nextAttemptAt: START + PROBE_MS }),
        ]),
      });
      await h.controller.start();
      expect(h.send).not.toHaveBeenCalled();
      expect(h.timers.map((t) => t.at)).toEqual([START + PROBE_MS]);
    });

    it("stops its timer when disposed, and ignores triggers afterwards", async () => {
      const h = harness({
        queue: createMemoryQueue([
          stored("ann", START, { state: "held", nextAttemptAt: START + PROBE_MS }),
        ]),
      });
      await h.controller.start();
      const before = h.snapshots.length;
      h.controller.dispose();
      expect(h.timers).toEqual([]);
      await h.controller.flush();
      await h.controller.refresh();
      expect(h.snapshots.length).toBe(before);
    });
  });

  it("sets nothing going after being disposed mid-run", async () => {
    let release: (outcome: SendOutcome) => void = () => undefined;
    const h = harness({ send: () => new Promise((resolve) => (release = resolve)) });
    await h.controller.enqueue(draft());
    h.controller.dispose();
    const before = h.snapshots.length;

    release({ kind: "network" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.timers).toEqual([]);
    expect(h.snapshots.length).toBe(before);
  });

  it("sends nothing more of the owner's once disposed, even mid-run (D-33-1)", async () => {
    let release: (outcome: SendOutcome) => void = () => undefined;
    const many = Array.from({ length: 101 }, (_, i) => stored("ann", START - 200 + i));
    const h = harness({
      queue: createMemoryQueue(many),
      send: () => new Promise((resolve) => (release = resolve)),
    });
    void h.controller.start();
    await vi.waitFor(() => {
      expect(h.send).toHaveBeenCalledTimes(1);
    });
    void h.controller.flush();

    h.controller.dispose();
    release({ kind: "ok", results: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The second batch of a hundred and one, and the re-run asked for, never go.
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  describe("wake", () => {
    it("sends at once when signal returns, without waiting out the backoff", async () => {
      let online = false;
      const h = harness({
        send: (items) => Promise.resolve(online ? applied(items) : { kind: "network" }),
      });
      await h.controller.enqueue(draft());
      await h.controller.flush();
      expect(h.last()?.block?.reason).toBe("offline");

      online = true;
      await h.controller.wake();
      expect(h.last()?.records[0]?.state).toBe("synced");
    });

    it("does not lift a wait the server asked for", async () => {
      const h = harness({
        send: () => Promise.resolve({ kind: "http", status: 429, code: "rate_limited" }),
      });
      await h.controller.enqueue(draft());
      await h.controller.flush();
      await h.controller.wake();
      expect(h.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry", () => {
    it("sends a held record again, from scratch", async () => {
      const held = stored("ann", START, {
        state: "held",
        nextAttemptAt: null,
        attempts: 3,
        lastError: { code: "conflict" },
      });
      const h = harness({ queue: createMemoryQueue([held]) });
      await h.controller.start();
      expect(h.send).not.toHaveBeenCalled();

      await h.controller.retry(held.id);
      expect(h.send).toHaveBeenCalledTimes(1);
      expect((await h.queue.get(held.id))?.state).toBe("synced");
    });

    it("ignores a record that is gone, already sent, unreadable or someone else's", async () => {
      const sent = stored("ann", START, { state: "synced", syncedAt: START });
      const corrupt = stored("ann", START, {
        state: "quarantined",
        lastError: { code: "corrupt" },
      });
      const theirs = stored("ben", START, { state: "held", nextAttemptAt: null });
      const h = harness({ queue: createMemoryQueue([sent, corrupt, theirs]) });
      await h.controller.start();

      for (const id of ["missing", sent.id, corrupt.id, theirs.id]) await h.controller.retry(id);

      expect(h.send).not.toHaveBeenCalled();
      expect(await h.queue.get(theirs.id)).toEqual(theirs);
    });

    it("lifts the clock wait so the fixed phone can try at once", async () => {
      let clockWrong = true;
      const h = harness({
        send: (items) =>
          Promise.resolve(
            clockWrong ? { kind: "http", status: 422, code: "clock_skew" } : applied(items),
          ),
      });
      await h.controller.enqueue(draft());
      await h.controller.flush();
      expect(h.last()?.block?.reason).toBe("clock");

      clockWrong = false;
      await h.controller.retryAll();
      expect(h.last()?.block).toBeNull();
      expect(h.last()?.records[0]?.state).toBe("synced");
    });

    it("still waits out a rate limit, even for a tap", async () => {
      const h = harness({
        send: () => Promise.resolve({ kind: "http", status: 429, code: "rate_limited" }),
      });
      await h.controller.enqueue(draft());
      await h.controller.flush();
      await h.controller.retryAll();
      expect(h.send).toHaveBeenCalledTimes(1);

      h.advance(RATE_LIMIT_MS);
      await h.controller.retryAll();
      expect(h.send).toHaveBeenCalledTimes(2);
    });

    it("retries every one of the owner's unsent records, and only those", async () => {
      const held = stored("ann", START, { state: "held", nextAttemptAt: null });
      const stopped = stored("ann", START + 1, { state: "quarantined", nextAttemptAt: null });
      const theirs = stored("ben", START, { state: "held", nextAttemptAt: null });
      const h = harness({ queue: createMemoryQueue([held, stopped, theirs]) });
      await h.controller.start();

      await h.controller.retryAll();

      const sent = h.send.mock.calls.flatMap(([items]) => items.map((item) => item.id));
      expect(sent.sort()).toEqual([held.id, stopped.id].sort());
    });
  });
});
