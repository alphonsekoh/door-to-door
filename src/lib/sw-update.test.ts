import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type { QueuedVisit } from "@/lib/sync/types";
import {
  activateWaitingWorker,
  hasRecordsToSend,
  hasUnsyncedItems,
  watchForWaitingWorker,
} from "@/lib/sw-update";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Listener = () => void;

function fakeRegistration(waiting: ServiceWorker | null = null) {
  const listeners = new Map<string, Listener>();
  const registration = {
    waiting,
    installing: null as ServiceWorker | null,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  return {
    registration: registration as unknown as ServiceWorkerRegistration,
    raw: registration,
    listeners,
  };
}

function fakeWorker() {
  const listeners = new Map<string, Listener>();
  const worker = {
    state: "installing",
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    postMessage: vi.fn(),
  };
  return { worker: worker as unknown as ServiceWorker, raw: worker, listeners };
}

describe("watchForWaitingWorker", () => {
  it("reports a worker already waiting behind an active one", () => {
    const { worker } = fakeWorker();
    const { registration } = fakeRegistration(worker);
    const onWaiting = vi.fn();

    watchForWaitingWorker(registration, () => true, onWaiting);

    expect(onWaiting).toHaveBeenCalledWith(worker);
  });

  it("does not call a first install an update", () => {
    const { worker } = fakeWorker();
    const { registration } = fakeRegistration(worker);
    const onWaiting = vi.fn();

    watchForWaitingWorker(registration, () => false, onWaiting);

    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("reports a worker that finishes installing later", () => {
    const { registration, raw, listeners } = fakeRegistration();
    const installing = fakeWorker();
    const onWaiting = vi.fn();
    watchForWaitingWorker(registration, () => true, onWaiting);

    raw.installing = installing.worker;
    listeners.get("updatefound")?.();
    expect(onWaiting).not.toHaveBeenCalled();

    installing.raw.state = "installed";
    installing.listeners.get("statechange")?.();
    expect(onWaiting).toHaveBeenCalledWith(installing.worker);
  });

  it("ignores states other than installed, and an update with no worker", () => {
    const { registration, raw, listeners } = fakeRegistration();
    const installing = fakeWorker();
    const onWaiting = vi.fn();
    watchForWaitingWorker(registration, () => true, onWaiting);

    listeners.get("updatefound")?.();
    raw.installing = installing.worker;
    listeners.get("updatefound")?.();
    installing.raw.state = "activating";
    installing.listeners.get("statechange")?.();

    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("stops listening when told to", () => {
    const { registration, listeners } = fakeRegistration();
    const stop = watchForWaitingWorker(registration, () => true, vi.fn());
    stop();
    expect(listeners.has("updatefound")).toBe(false);
  });
});

describe("activateWaitingWorker", () => {
  it("asks the worker to take over and reports when it has", () => {
    const addEventListener = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { addEventListener } });
    const { worker, raw } = fakeWorker();
    const done = vi.fn();

    activateWaitingWorker(worker, done);

    expect(raw.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", done, { once: true });
  });
});

const record = (ownerId: string, state: QueuedVisit["state"]): QueuedVisit => ({
  ...buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber: "#05-01",
      interestLevel: "high",
      description: "",
      name: "",
      contact: "",
      religion: "",
      sessionId: "0190a000-0000-7000-8000-0000000000cc",
    },
    ownerId,
    Date.now(),
  ),
  state,
});

const over =
  (...records: QueuedVisit[]) =>
  () =>
    Promise.resolve(createMemoryQueue(records));

describe("hasUnsyncedItems", () => {
  it("is true for any of the member's records not yet sent, held and stopped included", async () => {
    for (const state of ["queued", "failed", "held", "quarantined"] as const) {
      await expect(hasUnsyncedItems("ann", over(record("ann", state)))).resolves.toBe(true);
    }
  });

  it("is false once everything of theirs is sent", async () => {
    await expect(hasUnsyncedItems("ann", over(record("ann", "synced")))).resolves.toBe(false);
  });

  it("does not count another member's records", async () => {
    await expect(hasUnsyncedItems("ann", over(record("ben", "queued")))).resolves.toBe(false);
  });

  it("counts anyone's when no member is known", async () => {
    await expect(hasUnsyncedItems(undefined, over(record("ben", "held")))).resolves.toBe(true);
  });

  it("is false without IndexedDB, or when reading it fails", async () => {
    await expect(hasUnsyncedItems("ann", () => Promise.resolve(null))).resolves.toBe(false);
    await expect(hasUnsyncedItems("ann", () => Promise.reject(new Error("x")))).resolves.toBe(
      false,
    );
  });

  it("asks the page's own queue by default", async () => {
    // Node has no IndexedDB, so the shared queue is unavailable.
    await expect(hasUnsyncedItems("ann")).resolves.toBe(false);
  });
});

describe("hasRecordsToSend", () => {
  it("waits only for the member's records still being sent", async () => {
    await expect(hasRecordsToSend("ann", over(record("ann", "queued")))).resolves.toBe(true);
    await expect(hasRecordsToSend("ann", over(record("ann", "failed")))).resolves.toBe(true);
  });

  it("lets an update through past held, stopped and other members' records (D-33)", async () => {
    const queue = over(
      record("ann", "held"),
      record("ann", "quarantined"),
      record("ann", "synced"),
      record("ben", "queued"),
    );
    await expect(hasRecordsToSend("ann", queue)).resolves.toBe(false);
  });

  it("is false with nobody signed in", async () => {
    await expect(hasRecordsToSend(undefined, over(record("ann", "queued")))).resolves.toBe(false);
  });

  it("asks the page's own queue by default", async () => {
    await expect(hasRecordsToSend("ann")).resolves.toBe(false);
  });
});
