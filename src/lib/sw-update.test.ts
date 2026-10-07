import { afterEach, describe, expect, it, vi } from "vitest";
import { activateWaitingWorker, hasUnsyncedItems, watchForWaitingWorker } from "@/lib/sw-update";

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

describe("hasUnsyncedItems", () => {
  it("reports nothing queued until the offline queue exists", async () => {
    await expect(hasUnsyncedItems()).resolves.toBe(false);
  });
});
