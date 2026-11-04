import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishSignOut, signOutAndForget } from "@/lib/session/sign-out";
import { isLeavingOnPurpose } from "@/lib/session/navigate";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type * as ForgetSentModule from "@/lib/sync/forget-sent";
import type { SignedIn } from "@/lib/sync/signed-in";
import type { QueuedVisit, RecordState, SyncQueue } from "@/lib/sync/types";

const { clear, clearLocalCopy, forgetSentRecords, fetchSignedIn, disk } = vi.hoisted(() => ({
  clear: vi.fn(),
  clearLocalCopy: vi.fn(),
  forgetSentRecords: vi.fn<(ownerId: string | undefined) => Promise<void>>(),
  fetchSignedIn: vi.fn<(timeoutMs?: number) => Promise<SignedIn>>(),
  disk: { queue: null as SyncQueue | null },
}));
/* The deadline the forget runs under stays real. */
vi.mock(import("@/lib/pwa/sw-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  clearServiceWorkerCaches: clear,
}));
vi.mock("@/lib/offline/local-copy-store", () => ({ clearLocalCopy }));
vi.mock("@/lib/sync/forget-sent", () => ({ forgetSentRecords }));
vi.mock("@/lib/sync/idb-queue", () => ({ sharedQueue: () => Promise.resolve(disk.queue) }));
vi.mock("@/lib/sync/signed-in", () => ({ fetchSignedIn }));

/* The real forget, over the queue in memory, unless a test stands in for it. */
const { forgetSentRecords: realForget } =
  await vi.importActual<typeof ForgetSentModule>("@/lib/sync/forget-sent");

const ANN = "0190a000-0000-7000-8000-00000000000a";
const BEN = "0190a000-0000-7000-8000-00000000000b";

function record(ownerId: string, unitNumber: string, state: RecordState): QueuedVisit {
  const built = buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber,
      interestLevel: "high",
      description: "Asked us back on Sunday",
      name: "Mr Tan",
      contact: "91234567",
      religion: "",
      sessionId: "0190a000-0000-7000-8000-0000000000cc",
    },
    ownerId,
    Date.now(),
  );
  return state === "synced" ? { ...built, state, syncedAt: Date.now() } : { ...built, state };
}

let queue = createMemoryQueue();

async function unitsLeft(): Promise<string[]> {
  return (await queue.listAll()).map((r) => r.item.unitNumber).sort();
}

// What Auth.js hands back when the session really ended.
const signedOut = { url: "http://localhost:3210/account" };
const refused = { url: "http://localhost:3210/sign-in?error=MissingCSRF" };

const nobody: SignedIn = { kind: "member", id: null };
const ann: SignedIn = { kind: "member", id: "ann" };
const unanswered: SignedIn = { kind: "unknown" };

const NOTE = "d2d:just-signed-out";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clear.mockResolvedValue(undefined);
  clearLocalCopy.mockResolvedValue(undefined);
  forgetSentRecords.mockImplementation(realForget);
  queue = createMemoryQueue();
  disk.queue = queue;
  fetchSignedIn.mockResolvedValue(nobody);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signOutAndForget", () => {
  it("clears the cached lists, the copy and the member's sent records, signs out, checks, then goes to sign-in by relative path", async () => {
    const order: string[] = [];
    clear.mockImplementation(() => Promise.resolve(void order.push("clear")));
    clearLocalCopy.mockImplementation(() => Promise.resolve(void order.push("forget copy")));
    forgetSentRecords.mockImplementation(() => Promise.resolve(void order.push("forget sent")));
    fetchSignedIn.mockImplementation(() => {
      order.push("check");
      return Promise.resolve(nobody);
    });
    const signOut = vi.fn(() => {
      order.push("signOut");
      return Promise.resolve(signedOut);
    });
    const navigate = vi.fn((path: string) => void order.push(`go ${path}`));

    await signOutAndForget(signOut, ANN, undefined, navigate);

    expect(order).toEqual([
      "clear",
      "forget copy",
      "forget sent",
      "signOut",
      "check",
      "go /sign-in",
    ]);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    expect(forgetSentRecords).toHaveBeenCalledExactlyOnceWith(ANN);
  });

  it("takes the signing-out member's sent records with it, and nothing else on the phone", async () => {
    await queue.putMany([
      record(ANN, "#01-01", "synced"),
      record(ANN, "#01-02", "synced"),
      record(BEN, "#01-03", "synced"),
      record(ANN, "#02-01", "queued"),
      record(ANN, "#02-02", "failed"),
      record(ANN, "#02-03", "held"),
      record(ANN, "#02-04", "quarantined"),
      record(BEN, "#02-05", "queued"),
    ]);
    // Claims to be Ann's and sent, and is unreadable: never deleted (D-33-8).
    queue.raw.set("torn", { id: "torn", ownerId: ANN, state: "synced" });

    await signOutAndForget(() => Promise.resolve(signedOut), ANN, undefined, vi.fn());

    // Ben's sent record waits for his own sign-out or the 24 h purge (D-33-9).
    expect(await unitsLeft()).toEqual([
      "",
      "#01-03",
      "#02-01",
      "#02-02",
      "#02-03",
      "#02-04",
      "#02-05",
    ]);
  });

  it("forgets nobody's sent records when the screen no longer knows who is signing out", async () => {
    await queue.putMany([record(ANN, "#01-01", "synced"), record(BEN, "#01-02", "synced")]);
    const navigate = vi.fn();

    await signOutAndForget(() => Promise.resolve(signedOut), undefined, undefined, navigate);

    expect(await unitsLeft()).toEqual(["#01-01", "#01-02"]);
    expect(navigate).toHaveBeenCalledWith("/sign-in");
  });

  it.each([
    ["the caches cannot be cleared", clear],
    ["the offline copy cannot be cleared", clearLocalCopy],
    ["sent records cannot be forgotten", forgetSentRecords],
  ])("still signs out when %s", async (_, failing) => {
    failing.mockRejectedValue(new Error("IndexedDB is unavailable"));
    const signOut = vi.fn(() => Promise.resolve(signedOut));
    const navigate = vi.fn();

    await signOutAndForget(signOut, ANN, undefined, navigate);

    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/sign-in");
  });

  it("does not navigate when the sign-out itself fails", async () => {
    const navigate = vi.fn();
    await expect(
      signOutAndForget(() => Promise.reject(new Error("offline")), ANN, undefined, navigate),
    ).rejects.toThrow("offline");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not claim success when Auth.js refuses the sign-out", async () => {
    // A CSRF mismatch comes back as 200 with an error page URL, and the
    // session cookie is still valid.
    const navigate = vi.fn();
    await expect(
      signOutAndForget(() => Promise.resolve(refused), ANN, undefined, navigate),
    ).rejects.toThrow("MissingCSRF");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("signs out again when an answer sent before the sign-out has put the session back", async () => {
    // A session check in flight at sign-out, landing just after it with a
    // refreshed cookie (#129).
    fetchSignedIn.mockResolvedValueOnce(ann).mockResolvedValueOnce(nobody);
    const signOut = vi.fn(() => Promise.resolve(signedOut));
    const navigate = vi.fn();

    await signOutAndForget(signOut, ANN, undefined, navigate);

    expect(signOut).toHaveBeenCalledTimes(2);
    expect(fetchSignedIn).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/sign-in");
  });

  it("gives up, staying put, when the session keeps coming back", async () => {
    fetchSignedIn.mockResolvedValue(ann);
    const signOut = vi.fn(() => Promise.resolve(signedOut));
    const navigate = vi.fn();
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });

    await expect(signOutAndForget(signOut, ANN, undefined, navigate)).rejects.toThrow(
      "The session came back after signing out",
    );

    expect(signOut).toHaveBeenCalledTimes(3);
    expect(navigate).not.toHaveBeenCalled();
    expect(storage.data.has(NOTE)).toBe(false);
  });

  it("fails when a second sign-out is refused", async () => {
    fetchSignedIn.mockResolvedValue(ann);
    const signOut = vi
      .fn<() => Promise<{ url: string }>>()
      .mockResolvedValueOnce(signedOut)
      .mockResolvedValueOnce(refused);
    const navigate = vi.fn();

    await expect(signOutAndForget(signOut, ANN, undefined, navigate)).rejects.toThrow(
      "MissingCSRF",
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not hold the member up when nobody answers the check", async () => {
    // The sign-out itself succeeded; the sign-in page asks again.
    fetchSignedIn.mockResolvedValue(unanswered);
    const signOut = vi.fn(() => Promise.resolve(signedOut));
    const navigate = vi.fn();

    await signOutAndForget(signOut, ANN, undefined, navigate);

    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/sign-in");
  });

  it("asks with a shorter wait than a send's", async () => {
    await signOutAndForget(() => Promise.resolve(signedOut), ANN, undefined, vi.fn());
    expect(fetchSignedIn).toHaveBeenCalledWith(5_000);
  });

  it("leaves a note for the sign-in page to look again", async () => {
    const storage = memoryStorage();
    const replace = vi.fn();
    vi.stubGlobal("window", { sessionStorage: storage, location: { replace } });

    await signOutAndForget(() => Promise.resolve(signedOut), ANN);

    expect(storage.data.get(NOTE)).toBe("1");
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("still leaves when the note cannot be kept", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", {
      sessionStorage: {
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError");
        },
      },
      location: { replace },
    });

    await signOutAndForget(() => Promise.resolve(signedOut), ANN);

    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("replaces the page in history by default, as a departure the member chose", async () => {
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { assign, replace } });

    await signOutAndForget(() => Promise.resolve(signedOut), ANN);

    // So Back from sign-in cannot return to the signed-in screen (#129).
    expect(replace).toHaveBeenCalledWith("/sign-in");
    expect(assign).not.toHaveBeenCalled();
    // So the unsent-records warning does not stop it (D-33-23).
    expect(isLeavingOnPurpose()).toBe(true);
  });

  it("goes wherever the caller asks once signed out, replacing the page there too", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });

    await signOutAndForget(() => Promise.resolve(signedOut), ANN, "/sign-in?reason=signed-out");

    expect(replace).toHaveBeenCalledWith("/sign-in?reason=signed-out");
  });

  it("still refuses to navigate to a custom destination after a refusal", async () => {
    const navigate = vi.fn();
    await expect(
      signOutAndForget(() => Promise.resolve(refused), ANN, "/sign-in?reason=signed-out", navigate),
    ).rejects.toThrow("MissingCSRF");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("finishSignOut", () => {
  function noted() {
    const storage = memoryStorage();
    storage.setItem(NOTE, "1");
    vi.stubGlobal("window", { sessionStorage: storage });
    return storage;
  }

  it("asks nothing when no sign-out brought the member here", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage() });
    const signOut = vi.fn(() => Promise.resolve(signedOut));

    await finishSignOut(signOut);

    expect(fetchSignedIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("asks nothing where storage cannot be read", async () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
      },
    });
    const signOut = vi.fn(() => Promise.resolve(signedOut));

    await finishSignOut(signOut);

    expect(fetchSignedIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("leaves things be after a sign-out that held, and looks only once", async () => {
    const storage = noted();
    const signOut = vi.fn(() => Promise.resolve(signedOut));

    await finishSignOut(signOut);

    expect(fetchSignedIn).toHaveBeenCalledWith(5_000);
    expect(signOut).not.toHaveBeenCalled();
    expect(storage.data.has(NOTE)).toBe(false);
  });

  it("signs out again when the session came back during the navigation", async () => {
    const storage = noted();
    fetchSignedIn.mockResolvedValueOnce(ann).mockResolvedValueOnce(nobody);
    const signOut = vi.fn(() => Promise.resolve(signedOut));

    await finishSignOut(signOut);

    expect(signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false });
    expect(fetchSignedIn).toHaveBeenCalledTimes(2);
    expect(storage.data.has(NOTE)).toBe(false);
  });

  it("fails when the session will not go, without looking again on the next visit", async () => {
    // Otherwise a member who signs in next could be signed out by a later
    // visit to this page.
    const storage = noted();
    fetchSignedIn.mockResolvedValue(ann);
    const signOut = vi.fn(() => Promise.resolve(signedOut));

    await expect(finishSignOut(signOut)).rejects.toThrow("came back");

    expect(signOut).toHaveBeenCalledTimes(3);
    expect(storage.data.has(NOTE)).toBe(false);
  });

  it("does nothing more when nobody answers", async () => {
    const storage = noted();
    fetchSignedIn.mockResolvedValue(unanswered);
    const signOut = vi.fn(() => Promise.resolve(signedOut));

    await finishSignOut(signOut);

    expect(signOut).not.toHaveBeenCalled();
    expect(storage.data.has(NOTE)).toBe(false);
  });
});
