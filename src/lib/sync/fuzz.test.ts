import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { ErrorCode, VisitSyncItem, VisitSyncResult } from "@/generated/types.gen";
import { MAX_ATTEMPTS } from "@/lib/sync/backoff";
import { type SyncController, createSyncController } from "@/lib/sync/controller";
import { type VisitDraft, buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import { isCorrupt, readRecord } from "@/lib/sync/record";
import { type SignedIn, sendAs } from "@/lib/sync/signed-in";
import type { QueuedVisit, SendOutcome, SyncQueue } from "@/lib/sync/types";
import { uuidv7 } from "@/lib/uuid";

/*
 * Random online/offline/fault sequences against the real controller and
 * engine (#34). The server, the storage faults and the clock are simulated
 * here, in the test file, so the run is fast and every failure replays
 * exactly from its seed: FC_SEED and FC_RUNS override the defaults.
 *
 * Postgres semantics are proven separately in
 * server-convergence.integration.test.ts; this simulation follows them:
 * newest updatedAt wins, a replay is unchanged, an older one stale, and a
 * stored visit keeps its author and first stamp.
 */

/* uuidv7's random bits break ties in send order; a counter keeps a failing
   sequence reproducible. */
const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock("@/lib/uuid", () => ({
  uuidv7: () => {
    ids.next += 1;
    return `0190a000-0000-7000-8000-${ids.next.toString(16).padStart(12, "0")}`;
  },
}));

const SEED = Number(process.env["FC_SEED"] ?? 34);
const RUNS = Number(process.env["FC_RUNS"] ?? 150);
const MAX_STEPS = 80;

const START = Date.parse("2026-10-15T10:00:00.000Z");
const SESSION = "0190a000-0000-7000-8000-0000000000cc";
const BLOCK = "0190a000-0000-7000-8000-0000000000bb";
const OWNERS = ["ann", "ben"] as const;
type Owner = (typeof OWNERS)[number];

/* Marks a record whose every request the server refuses as malformed. */
const POISON = "poison";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- the simulated world ---------------------------------------------- */

type ServerFault =
  | "healthy"
  | "network"
  | "lost_reply"
  | "server_error"
  | "rate_limited"
  | "unauthorized"
  | "clock_skew"
  | "all_internal"
  | "per_item"
  /* Answers for every item but the first: the record that never gets through. */
  | "drop_first";

type Cookie = Owner | "nobody" | "unknown";
type Storage = "ok" | "fail_next_write" | "quota" | "closed";

type Step =
  | { kind: "save"; poison: boolean; unit: number }
  | { kind: "network"; online: boolean }
  | { kind: "server"; fault: ServerFault }
  | { kind: "session"; active: boolean }
  | { kind: "cookie"; cookie: Cookie }
  | { kind: "next_timer" }
  | { kind: "advance"; ms: number }
  | { kind: "wake" }
  | { kind: "retry_all" }
  | { kind: "retry"; pick: number }
  | { kind: "storage"; storage: Storage }
  | { kind: "reload"; owner: Owner }
  | { kind: "damage"; pick: number; owner: Owner }
  | { kind: "corrupt"; owner: Owner; how: "item" | "no_outing" | "renamed" | "renamed_damaged" };

type Row = { item: VisitSyncItem; memberId: string };

/* Past the fixed BLOCK and SESSION ids, so no generated id can be one. */
const FIRST_ID = 0x1000;

function world(seed: number) {
  // Each run starts the counter afresh, so a seed and path replay its ids exactly.
  ids.next = FIRST_ID;
  const random = mulberry32(seed);
  let now = START;
  let online = true;
  let fault: ServerFault = "healthy";
  let sessionActive = true;
  let cookie: Cookie = "ann";
  let storage: Storage = "ok";

  const rows = new Map<string, Row>();
  const reached = new Set<string>();
  /* Collected rather than thrown: the controller swallows what a send throws. */
  const violations: string[] = [];
  /* Failures the engine is allowed to charge a record, since its last retry. */
  const charged = new Map<string, number>();
  const charge = (id: string) => charged.set(id, (charged.get(id) ?? 0) + 1);

  const store = createMemoryQueue();
  const failing = () => Promise.reject(new DOMException("disk", "QuotaExceededError"));
  const write = <T>(run: () => Promise<T>): Promise<T> => {
    if (storage === "fail_next_write") {
      storage = "ok";
      return failing();
    }
    return storage === "quota" || storage === "closed" ? failing() : run();
  };
  const read = <T>(run: () => Promise<T>): Promise<T> => (storage === "closed" ? failing() : run());
  const queue: SyncQueue = {
    put: (record) => write(() => store.put(record)),
    putMany: (records) => write(() => store.putMany(records)),
    deleteSyncedBefore: (before) => write(() => store.deleteSyncedBefore(before)),
    get: (id) => read(() => store.get(id)),
    listByOwner: (owner) => read(() => store.listByOwner(owner)),
    listAll: () => read(() => store.listAll()),
  };

  const rejected = (id: string, code: ErrorCode): VisitSyncResult => ({
    id,
    status: "rejected",
    error: { error: { code, message: "" } },
  });

  /* One item, as /visits/sync judges it (src/server/visits/sync.ts). */
  function judge(item: VisitSyncItem, memberId: string, itemFault: string): VisitSyncResult {
    const stored = rows.get(item.id);
    if (itemFault === "conflict") return rejected(item.id, "conflict");
    if (stored !== undefined) {
      if (stored.memberId !== memberId) return rejected(item.id, "conflict");
      if (item.updatedAt < stored.item.updatedAt) return { id: item.id, status: "stale" };
      if (item.updatedAt === stored.item.updatedAt) return { id: item.id, status: "unchanged" };
    }
    if (itemFault === "clock_skew") return rejected(item.id, "clock_skew");
    if (!sessionActive || item.sessionId !== SESSION) {
      return rejected(item.id, "session_not_active");
    }
    rows.set(
      item.id,
      stored === undefined
        ? { item: structuredClone(item), memberId }
        : { ...stored, item: { ...stored.item, updatedAt: item.updatedAt } },
    );
    return { id: item.id, status: "applied" };
  }

  function server(items: VisitSyncItem[], memberId: string): SendOutcome {
    for (const item of items) {
      reached.add(item.id);
      // Nothing goes out under a cookie that is not the record's owner (D-33-1).
      const ownerId = readRecord(store.raw.get(item.id)).ownerId;
      if (ownerId !== memberId) violations.push(`${item.id} of ${ownerId} sent as ${memberId}`);
    }
    if (fault === "network") return { kind: "network" };
    if (fault === "server_error") return { kind: "http", status: 503, code: "internal_error" };
    if (fault === "rate_limited") return { kind: "http", status: 429, code: "rate_limited" };
    if (fault === "unauthorized") return { kind: "http", status: 401, code: "unauthorized" };
    if (fault === "clock_skew") return { kind: "http", status: 422, code: "clock_skew" };
    if (items.some((item) => item.description === POISON)) {
      if (items.length === 1 && items[0] !== undefined) charge(items[0].id);
      return { kind: "http", status: 400, code: "validation_error" };
    }
    if (fault === "all_internal") {
      return { kind: "ok", results: items.map((item) => rejected(item.id, "internal_error")) };
    }

    const faults = items.map((_, i) => {
      if (fault === "drop_first") return i === 0 ? "missing" : "none";
      if (fault !== "per_item") return "none";
      const roll = random();
      if (roll < 0.15) return "internal_error";
      if (roll < 0.25) return "missing";
      if (roll < 0.3) return "clock_skew";
      if (roll < 0.35) return "conflict";
      return "none";
    });
    const together = faults.every((f) => f === "internal_error");
    const results: VisitSyncResult[] = [];
    items.forEach((item, i) => {
      const itemFault = faults[i] ?? "none";
      if (itemFault === "missing") {
        charge(item.id);
        return;
      }
      if (itemFault === "internal_error") {
        if (!together) charge(item.id);
        results.push(rejected(item.id, "internal_error"));
        return;
      }
      results.push(judge(item, memberId, itemFault));
    });
    // Stored, then the reply never arrives: the replay must be harmless.
    if (fault === "lost_reply") return { kind: "network" };
    return { kind: "ok", results };
  }

  const timers: { callback: () => void; at: number; id: number }[] = [];
  let nextTimer = 0;
  let owner: Owner = "ann";

  function makeController(pageOwner: Owner): SyncController {
    const signedIn = (): Promise<SignedIn> =>
      Promise.resolve(
        cookie === "unknown"
          ? { kind: "unknown" }
          : { kind: "member", id: cookie === "nobody" ? null : cookie },
      );
    const send = (items: VisitSyncItem[]): Promise<SendOutcome> => {
      if (!online) return Promise.resolve({ kind: "network" });
      // sendAs only lets a send through for the cookie's own member.
      return Promise.resolve(server(items, cookie));
    };
    return createSyncController({
      queue,
      ownerId: pageOwner,
      send: sendAs(pageOwner, send, signedIn, () => undefined),
      now: () => now,
      random,
      setTimer: (callback, ms) => {
        nextTimer += 1;
        timers.push({ callback, at: now + ms, id: nextTimer });
        return nextTimer;
      },
      clearTimer: (handle) => {
        const index = timers.findIndex((timer) => timer.id === handle);
        if (index !== -1) timers.splice(index, 1);
      },
      onChange: () => undefined,
    });
  }

  let controller = makeController(owner);

  /* Every chain here resolves on microtasks; one macrotask drains them all. */
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  /* Fires each timer due by `target` in order. A timer that keeps firing
     with the clock standing still is a retry loop, not a backoff. */
  async function runTimersUntil(target: number): Promise<void> {
    let stalled = 0;
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers.splice(timers.indexOf(due), 1);
      stalled = due.at <= now ? stalled + 1 : 0;
      expect(stalled, "a timer re-armed itself with no wait").toBeLessThan(10);
      now = Math.max(now, due.at);
      due.callback();
      await settle();
    }
    now = Math.max(now, target);
  }

  async function reload(pageOwner: Owner): Promise<void> {
    controller.dispose();
    owner = pageOwner;
    controller = makeController(pageOwner);
    await controller.start();
    await settle();
  }

  /* Retry resets attempts, so the charges against those records start over. */
  async function retried(run: () => Promise<void>, which: readonly string[]): Promise<void> {
    const before = storage;
    const kept = new Map(which.map((id) => [id, charged.get(id)]));
    for (const id of which) charged.delete(id);
    try {
      await run();
    } catch {
      // Rejected before anything was written or sent, so nothing was reset.
      expect(before).not.toBe("ok");
      for (const [id, count] of kept) if (count !== undefined) charged.set(id, count);
    }
  }

  const retryable = (): string[] =>
    [...store.raw.values()]
      .map(readRecord)
      .filter((r) => r.ownerId === owner && r.state !== "synced" && !isCorrupt(r))
      .map((r) => r.id);

  return {
    store,
    rows,
    reached,
    violations,
    charged,
    get now() {
      return now;
    },
    get owner() {
      return owner;
    },
    get storage() {
      return storage;
    },
    get timers() {
      return timers;
    },
    controller: () => controller,
    settle,
    runTimersUntil,
    reload,
    retried,
    retryable,
    set: {
      online: (value: boolean) => (online = value),
      fault: (value: ServerFault) => (fault = value),
      session: (value: boolean) => (sessionActive = value),
      cookie: (value: Cookie) => (cookie = value),
      storage: (value: Storage) => (storage = value),
    },
  };
}

/* ---- steps ------------------------------------------------------------- */

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("save" as const),
      poison: fc.nat(9).map((n) => n === 0),
      unit: fc.nat(40),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant("network" as const), online: fc.boolean() }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("server" as const),
      fault: fc.constantFrom<ServerFault>(
        "healthy",
        "healthy",
        "network",
        "lost_reply",
        "server_error",
        "rate_limited",
        "unauthorized",
        "clock_skew",
        "all_internal",
        "per_item",
        "per_item",
        "drop_first",
        "drop_first",
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("session" as const), active: fc.boolean() }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("cookie" as const),
      cookie: fc.constantFrom<Cookie>("ann", "ann", "ben", "nobody", "unknown"),
    }),
  },
  { weight: 4, arbitrary: fc.constant({ kind: "next_timer" as const }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("advance" as const),
      ms: fc.oneof(fc.nat(10_000), fc.nat(600_000), fc.nat(30 * 60 * 60 * 1000)),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ kind: "wake" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "retry_all" as const }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("retry" as const), pick: fc.nat() }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("storage" as const),
      storage: fc.constantFrom<Storage>("ok", "ok", "fail_next_write", "quota", "closed"),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("reload" as const),
      owner: fc.constantFrom<Owner>(...OWNERS),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("damage" as const),
      pick: fc.nat(),
      owner: fc.constantFrom<Owner>(...OWNERS),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("corrupt" as const),
      owner: fc.constantFrom<Owner>(...OWNERS),
      how: fc.constantFrom<"item" | "no_outing" | "renamed" | "renamed_damaged">(
        "item",
        "no_outing",
        "renamed",
        "renamed_damaged",
      ),
    }),
  },
);

const draft = (unit: number, poison: boolean): VisitDraft => ({
  blockId: BLOCK,
  unitNumber: `#05-${String(unit).padStart(2, "0")}`,
  interestLevel: "medium",
  description: poison ? POISON : "",
  name: "",
  contact: "",
  religion: "",
  sessionId: SESSION,
});

/* ---- the property ------------------------------------------------------ */

type Tracked = {
  /* Saved through the queue, or salvageable rows put there by hand. */
  saved: Set<string>;
  poison: Set<string>;
  /* Rows no build could read, as written, to check they are never touched. */
  corrupt: Map<string, unknown>;
  /* Item ids of corrupt rows filed under another id. */
  renamed: Set<string>;
  /* The last state seen for each record, to tell a purge from a loss. */
  lastState: Map<string, QueuedVisit["state"]>;
};

function checkInvariants(w: ReturnType<typeof world>, t: Tracked): void {
  expect(w.violations).toEqual([]);
  for (const id of t.saved) {
    const raw = w.store.raw.get(id);
    if (raw === undefined) {
      // Only a record the server holds, and that was seen sent, may be gone (D-33-2).
      expect(t.lastState.get(id), `${id} vanished unsent`).toBe("synced");
      expect(w.rows.has(id)).toBe(true);
      continue;
    }
    const record = readRecord(raw);
    t.lastState.set(id, record.state);

    // The cap (D-33-26), and no charge the server did not earn (D-33-27).
    expect(record.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(record.attempts).toBeLessThanOrEqual(w.charged.get(id) ?? 0);

    if (record.state === "quarantined") {
      const code = record.lastError?.code;
      if (code === "invalid") expect(t.poison.has(id)).toBe(true);
      else {
        expect(record.attempts).toBe(MAX_ATTEMPTS);
        expect(w.charged.get(id) ?? 0).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
      }
    }
    if (record.state === "synced") expect(w.rows.has(id)).toBe(true);
    expect(isCorrupt(record)).toBe(false);
  }

  for (const [id, raw] of t.corrupt) {
    // Never sent, never deleted, never rewritten (D-33-8).
    expect(w.reached.has(id)).toBe(false);
    expect(w.store.raw.get(id)).toEqual(raw);
    expect(isCorrupt(readRecord(raw))).toBe(true);
  }

  for (const id of t.poison) expect(w.rows.has(id)).toBe(false);
  for (const id of t.renamed) expect(w.reached.has(id)).toBe(false);

  // Every row the server holds is stored under the member who saved it.
  for (const [id, row] of w.rows) {
    const raw = w.store.raw.get(id);
    if (raw !== undefined) expect(row.memberId).toBe(readRecord(raw).ownerId);
  }
}

async function apply(w: ReturnType<typeof world>, t: Tracked, s: Step): Promise<void> {
  const controller = w.controller();
  switch (s.kind) {
    case "save": {
      const before = w.storage;
      try {
        const record = await controller.enqueue(draft(s.unit, s.poison));
        t.saved.add(record.id);
        if (s.poison) t.poison.add(record.id);
      } catch {
        // The form saves straight to the server instead (D-33-10).
        expect(before).not.toBe("ok");
      }
      break;
    }
    case "network":
      w.set.online(s.online);
      if (s.online) await controller.wake();
      break;
    case "server":
      w.set.fault(s.fault);
      break;
    case "session":
      w.set.session(s.active);
      break;
    case "cookie":
      w.set.cookie(s.cookie);
      break;
    case "next_timer": {
      const next = [...w.timers].sort((a, b) => a.at - b.at)[0];
      if (next !== undefined) await w.runTimersUntil(Math.max(next.at, w.now));
      break;
    }
    case "advance":
      await w.runTimersUntil(w.now + s.ms);
      break;
    case "wake":
      await controller.wake();
      break;
    case "retry_all":
      await w.retried(() => controller.retryAll(), w.retryable());
      break;
    case "retry": {
      const mine = w.retryable();
      const id = mine[s.pick % Math.max(1, mine.length)];
      if (id !== undefined) await w.retried(() => controller.retry(id), [id]);
      break;
    }
    case "storage":
      w.set.storage(s.storage);
      break;
    case "reload":
      await w.reload(s.owner);
      break;
    case "damage": {
      /* Bookkeeping no build wrote: an existing record (perhaps already on
         the server), or a new one, with its knock and owner intact. */
      const existing = [...t.saved].filter((id) => !t.poison.has(id) && w.store.raw.has(id));
      const id = existing[s.pick % Math.max(1, existing.length)];
      const base =
        id === undefined
          ? buildQueuedVisit(draft(s.pick % 40, false), s.owner, w.now)
          : readRecord(w.store.raw.get(id));
      w.store.raw.set(base.id, { ...base, state: "sending", attempts: -1, syncedAt: "?" });
      t.saved.add(base.id);
      w.charged.delete(base.id);
      break;
    }
    case "corrupt": {
      const record = buildQueuedVisit(draft(0, false), s.owner, w.now);
      const { sessionId: _outing, ...withoutOuting } = record.item;
      /* A knock filed under another id: its result could never be matched. */
      const renamed = { ...record.item, id: uuidv7() };
      const raw =
        s.how === "no_outing"
          ? { ...record, item: withoutOuting }
          : s.how === "renamed"
            ? { ...record, item: renamed }
            : s.how === "renamed_damaged"
              ? { ...record, state: "sending", item: renamed }
              : { ...record, state: "sending", item: { ...record.item, interestLevel: "keen" } };
      if (s.how === "renamed" || s.how === "renamed_damaged") t.renamed.add(renamed.id);
      w.store.raw.set(record.id, raw);
      t.corrupt.set(record.id, structuredClone(raw));
      break;
    }
  }
  await w.settle();
}

/* Signal back, server well, outing open, disk fine: each member signs in
   once more and taps Retry all, and the queue is left to finish. */
async function heal(w: ReturnType<typeof world>): Promise<void> {
  w.set.online(true);
  w.set.fault("healthy");
  w.set.session(true);
  w.set.storage("ok");
  for (const owner of OWNERS) {
    w.set.cookie(owner);
    await w.reload(owner);
    await w.retried(() => w.controller().retryAll(), w.retryable());
    for (let i = 0; i < 50 && w.timers.length > 0; i += 1) {
      const next = [...w.timers].sort((a, b) => a.at - b.at)[0];
      if (next !== undefined) await w.runTimersUntil(Math.max(next.at, w.now));
    }
  }
}

function checkConverged(w: ReturnType<typeof world>, t: Tracked): void {
  const delivered = [...t.saved].filter((id) => !t.poison.has(id));
  for (const id of delivered) {
    const row = w.rows.get(id);
    expect(row, `${id} never reached the server`).toBeDefined();
    const raw = w.store.raw.get(id);
    if (raw === undefined) continue;
    const record = readRecord(raw);
    expect(record.state).toBe("synced");
    // The newest version, a restamp included; the first stamp stays the server's.
    expect({ ...row?.item, clientCreatedAt: null }).toEqual({
      ...record.item,
      clientCreatedAt: null,
    });
    expect(row?.memberId).toBe(record.ownerId);
  }
  for (const id of t.poison) {
    expect(readRecord(w.store.raw.get(id))).toMatchObject({
      state: "quarantined",
      lastError: { code: "invalid" },
    });
  }
  expect(w.rows.size).toBe(delivered.length);
}

describe("offline sync under random sequences", () => {
  it("keeps every record, sends each only as its owner, and converges once healed", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer(),
        fc.array(step, { maxLength: MAX_STEPS, size: "max" }),
        async (seed, steps) => {
          const w = world(seed);
          const t: Tracked = {
            saved: new Set(),
            poison: new Set(),
            corrupt: new Map(),
            renamed: new Set(),
            lastState: new Map(),
          };
          await w.controller().start();
          for (const s of steps) {
            await apply(w, t, s);
            checkInvariants(w, t);
          }
          await heal(w);
          checkInvariants(w, t);
          checkConverged(w, t);
          w.controller().dispose();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  }, 30_000);
});
