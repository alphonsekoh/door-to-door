import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetThreads, useThreadCache } from "@/components/sync/thread-cache";
import type { HouseholdHistory } from "@/generated/types.gen";
import type { LocalCopy } from "@/lib/offline/local-copy";
import { entryFor, history, OUTING_ID, STAMP, thread } from "../../../test/thread-fixtures";

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { loadLocalCopy, updateLocalCopy } = vi.hoisted(() => ({
  loadLocalCopy: vi.fn<() => Promise<LocalCopy | null>>(),
  updateLocalCopy: vi.fn<(change: (copy: LocalCopy | null) => LocalCopy | null) => Promise<void>>(),
}));
vi.mock("@/lib/offline/local-copy-store", () => ({ loadLocalCopy, updateLocalCopy }));

const { readThread } = vi.hoisted(() => ({
  readThread: vi.fn<(id: string) => Promise<HouseholdHistory | null>>(),
}));
vi.mock("@/lib/offline/read-thread", () => ({ readThread }));

const ALICE = "0190a000-0000-7000-8000-00000000000a";

function copyWith(threads: LocalCopy["threads"], member = ALICE, outingId = OUTING_ID): LocalCopy {
  return {
    v: 3,
    member: { id: member, name: "Alice" },
    savedAt: Date.now(),
    outing: {
      id: outingId,
      title: "Follow-up",
      kind: "follow_up",
      status: "active",
      startedAt: STAMP,
      endedAt: null,
      createdBy: { id: ALICE, name: "Admin" },
      createdAt: STAMP,
    },
    blocks: [],
    revisits: [1, 2, 3, 4, 5].map((n) => entryFor(history(n))),
    threads,
  };
}

const LIST = [1, 2, 3, 4, 5].map((n) => entryFor(history(n)));
const ids = (threads: readonly { history: HouseholdHistory }[]) =>
  threads.map((t) => t.history.household.unitNumber);

beforeEach(() => {
  vi.clearAllMocks();
  forgetThreads();
  useRole.mockReturnValue({ userId: ALICE });
  loadLocalCopy.mockResolvedValue(null);
  updateLocalCopy.mockResolvedValue(undefined);
  readThread.mockResolvedValue(null);
});

type Props = Parameters<typeof useThreadCache>[0];
const hook = (props: Props) => renderHook((p: Props) => useThreadCache(p), { initialProps: props });

describe("useThreadCache, reading the copy", () => {
  it("exposes the stored threads of the outing that are on the list", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now()), thread(2, Date.now())]));
    const { result } = hook({
      outingId: OUTING_ID,
      revisits: [entryFor(history(2))],
      preload: false,
    });
    await waitFor(() => {
      expect(ids(result.current.threads)).toEqual(["#05-02"]);
    });
  });

  it("exposes them all while the list is not known", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now()), thread(2, Date.now())]));
    const { result } = hook({ outingId: OUTING_ID, revisits: null, preload: false });
    await waitFor(() => {
      expect(result.current.threads).toHaveLength(2);
    });
  });

  it("exposes none of another outing's, another member's, or an unreadable copy's", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now())]));
    const other = hook({
      outingId: "0190a000-0000-7000-8000-0000000000ee",
      revisits: LIST,
      preload: false,
    });
    const none = hook({ outingId: null, revisits: LIST, preload: false });
    await waitFor(() => {
      expect(loadLocalCopy).toHaveBeenCalled();
    });
    expect(other.result.current.threads).toEqual([]);
    expect(none.result.current.threads).toEqual([]);

    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now())], "someone-else"));
    const theirs = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    loadLocalCopy.mockRejectedValue(new Error("no IndexedDB"));
    forgetThreads();
    const broken = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(theirs.result.current.threads).toEqual([]);
    expect(broken.result.current.threads).toEqual([]);
  });

  it("reads nothing until it knows who is signed in", () => {
    useRole.mockReturnValue({ userId: undefined });
    hook({ outingId: OUTING_ID, revisits: LIST, preload: true });
    expect(loadLocalCopy).not.toHaveBeenCalled();
    expect(readThread).not.toHaveBeenCalled();
  });

  it("takes a copy the page already read, without reading it again", () => {
    const { result } = hook({
      outingId: OUTING_ID,
      revisits: LIST,
      preload: false,
      copy: copyWith([thread(3, Date.now())]),
    });
    expect(loadLocalCopy).not.toHaveBeenCalled();
    expect(ids(result.current.threads)).toEqual(["#05-03"]);
  });

  it("takes a copy with no outing as holding nothing for this one", () => {
    const { result } = hook({
      outingId: OUTING_ID,
      revisits: LIST,
      preload: false,
      copy: { ...copyWith([thread(3, Date.now())]), outing: null },
    });
    expect(result.current.threads).toEqual([]);
  });
});

describe("useThreadCache, filling the threads", () => {
  it("reads only the threads that are missing or moved, three at a time, keeping each batch once", async () => {
    const gates: { id: string; open: () => void }[] = [];
    readThread.mockImplementation(
      (id) =>
        new Promise((resolve) => {
          gates.push({
            id,
            open: () => {
              resolve(history(Number(id.slice(-1))));
            },
          });
        }),
    );
    loadLocalCopy.mockResolvedValue(copyWith([thread(2, Date.now())]));
    const { result } = hook({ outingId: OUTING_ID, revisits: LIST, preload: true });

    await waitFor(() => {
      expect(gates).toHaveLength(3);
    });
    expect(gates.map((g) => g.id.slice(-1))).toEqual(["1", "3", "4"]);
    /* Alone: a second argument would be the read's timeout. */
    expect(readThread.mock.calls.map((call) => call.length)).toEqual([1, 1, 1]);
    expect(updateLocalCopy).not.toHaveBeenCalled();
    act(() => {
      gates.forEach((g) => {
        g.open();
      });
    });
    await waitFor(() => {
      expect(updateLocalCopy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(gates).toHaveLength(4);
    });
    act(() => {
      gates[3]?.open();
    });
    await waitFor(() => {
      expect(updateLocalCopy).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.threads).toHaveLength(5);
    });
    const change = updateLocalCopy.mock.calls[0]?.[0];
    expect(change?.(copyWith([]))?.threads.map((t) => t.history.household.unitNumber)).toEqual([
      "#05-01",
      "#05-03",
      "#05-04",
    ]);
  });

  it("starts no second run while one is going, and none when everything is held", async () => {
    let open: () => void = () => undefined;
    readThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          open = () => {
            resolve(null);
          };
        }),
    );
    loadLocalCopy.mockResolvedValue(copyWith([]));
    const { rerender } = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(1);
    });
    rerender({ outingId: OUTING_ID, revisits: LIST.slice(0, 2), preload: true });
    expect(readThread).toHaveBeenCalledTimes(1);
    await act(async () => {
      open();
      await Promise.resolve();
    });
  });

  it("keeps quiet when a read fails, and reads that unit again at the next list", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([]));
    const { rerender, result } = hook({
      outingId: OUTING_ID,
      revisits: LIST.slice(0, 1),
      preload: true,
    });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateLocalCopy).not.toHaveBeenCalled();
    expect(result.current.threads).toEqual([]);
    readThread.mockResolvedValue(history(1));
    rerender({ outingId: OUTING_ID, revisits: [...LIST.slice(0, 1)], preload: true });
    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1);
    });
  });

  it.each([
    ["the list is unread", { revisits: undefined, preload: true, outingId: OUTING_ID }],
    ["the list failed", { revisits: null, preload: true, outingId: OUTING_ID }],
    ["preloading is off", { revisits: LIST, preload: false, outingId: OUTING_ID }],
    ["there is no session", { revisits: LIST, preload: true, outingId: null }],
  ])("reads nothing while %s", async (_, props) => {
    loadLocalCopy.mockResolvedValue(copyWith([]));
    hook(props);
    await waitFor(() => {
      expect(loadLocalCopy).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(readThread).not.toHaveBeenCalled();
  });

  it("is silent when the copy cannot be written", async () => {
    updateLocalCopy.mockRejectedValue(new Error("quota"));
    readThread.mockResolvedValue(history(1));
    loadLocalCopy.mockResolvedValue(copyWith([]));
    const { result } = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1);
    });
  });

  it("starts no further batch once the screen is gone, but keeps what it had read", async () => {
    const opens: (() => void)[] = [];
    readThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          opens.push(() => {
            resolve(history(1));
          });
        }),
    );
    loadLocalCopy.mockResolvedValue(copyWith([]));
    const { unmount } = hook({ outingId: OUTING_ID, revisits: LIST, preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(3);
    });
    unmount();
    await act(async () => {
      opens.forEach((open) => {
        open();
      });
      await Promise.resolve();
    });
    expect(readThread).toHaveBeenCalledTimes(3);
    expect(updateLocalCopy).toHaveBeenCalledTimes(1);
  });
});

describe("useThreadCache, edge cases", () => {
  it("ignores a copy that arrives after the screen is gone", async () => {
    let arrive: (copy: LocalCopy | null) => void = () => undefined;
    loadLocalCopy.mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    const { unmount } = hook({ outingId: OUTING_ID, revisits: LIST, preload: true });
    unmount();
    await act(async () => {
      arrive(copyWith([]));
      await Promise.resolve();
    });
    expect(readThread).not.toHaveBeenCalled();
  });

  it("holds nothing of a copy that has no outing, and reads every unit for the session", async () => {
    loadLocalCopy.mockResolvedValue({ ...copyWith([thread(1, Date.now())]), outing: null });
    hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 2), preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(2);
    });
  });

  it("reads nothing when every thread is held and agrees with the list", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([1, 2].map((n) => thread(n, Date.now()))));
    const { result } = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 2), preload: true });
    await waitFor(() => {
      expect(result.current.threads).toHaveLength(2);
    });
    expect(readThread).not.toHaveBeenCalled();
  });
});

describe("useThreadCache, noteRead", () => {
  it("keeps a unit's history the form read, for the copy and for the thread shown", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([]));
    const { result } = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    await waitFor(() => {
      expect(loadLocalCopy).toHaveBeenCalled();
    });
    act(() => {
      result.current.noteRead(history(4));
    });
    expect(ids(result.current.threads)).toEqual(["#05-04"]);
    expect(updateLocalCopy).toHaveBeenCalledTimes(1);
  });

  it("holds a read for a unit that is no longer on the list out of the thread", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([]));
    const { result } = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: false });
    await waitFor(() => {
      expect(loadLocalCopy).toHaveBeenCalled();
    });
    act(() => {
      result.current.noteRead(history(4));
    });
    expect(result.current.threads).toEqual([]);
  });

  it("keeps nothing with no session", () => {
    const { result } = hook({ outingId: null, revisits: LIST, preload: false });
    act(() => {
      result.current.noteRead(history(1));
    });
    expect(updateLocalCopy).not.toHaveBeenCalled();
  });

  it("starts a fresh set when the copy it read belongs to another outing", async () => {
    loadLocalCopy.mockResolvedValue(
      copyWith([thread(1, Date.now())], ALICE, "0190a000-0000-7000-8000-0000000000ee"),
    );
    const { result } = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    await waitFor(() => {
      expect(loadLocalCopy).toHaveBeenCalled();
    });
    act(() => {
      result.current.noteRead(history(2));
    });
    expect(ids(result.current.threads)).toEqual(["#05-02"]);
  });
});

describe("useThreadCache, before the list is read", () => {
  it.each([
    ["unread", undefined],
    ["failed", null],
  ])(
    "keeps a read only for a unit on the copy's list while the list is %s",
    async (_, revisits) => {
      loadLocalCopy.mockResolvedValue({
        ...copyWith([]),
        revisits: LIST.slice(0, 2),
      });
      const { result } = hook({ outingId: OUTING_ID, revisits, preload: false });
      await waitFor(() => {
        expect(loadLocalCopy).toHaveBeenCalled();
      });
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        result.current.noteRead(history(4));
      });
      expect(result.current.threads).toEqual([]);
      act(() => {
        result.current.noteRead(history(2));
      });
      expect(ids(result.current.threads)).toEqual(["#05-02"]);
    },
  );

  it("keeps no read at all while neither list is known", async () => {
    loadLocalCopy.mockResolvedValue({ ...copyWith([]), revisits: null });
    const { result } = hook({ outingId: OUTING_ID, revisits: undefined, preload: false });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.noteRead(history(1));
    });
    expect(result.current.threads).toEqual([]);
  });

  it("shows nothing for a copy that holds no list", async () => {
    loadLocalCopy.mockResolvedValue({ ...copyWith([thread(1, Date.now())]), revisits: null });
    const { result } = hook({ outingId: OUTING_ID, revisits: null, preload: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.threads).toEqual([]);
  });
});

describe("useThreadCache, taking the copy's outing", () => {
  it("shows the copy's threads before the session answers, when told to", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now())]));
    const { result, rerender } = hook({
      outingId: null,
      revisits: undefined,
      preload: true,
      assumeCopyOuting: true,
    });
    await waitFor(() => {
      expect(ids(result.current.threads)).toEqual(["#05-01"]);
    });
    expect(readThread).not.toHaveBeenCalled();
    rerender({ outingId: "0190a000-0000-7000-8000-0000000000ee", revisits: LIST, preload: false });
    expect(result.current.threads).toEqual([]);
  });

  it("shows none when not told to", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now())]));
    const { result } = hook({ outingId: null, revisits: undefined, preload: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.threads).toEqual([]);
  });

  it("shows none when the copy has no outing", async () => {
    loadLocalCopy.mockResolvedValue({ ...copyWith([thread(1, Date.now())]), outing: null });
    const { result } = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.threads).toEqual([]);
  });
});

describe("useThreadCache, handing the threads to the next screen", () => {
  it("has the threads on the first render of a screen opened after one that read them", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now())]));
    const first = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.unmount();

    loadLocalCopy.mockReturnValue(new Promise(() => undefined));
    const second = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
  });

  it("never hands one member's threads to another", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([thread(1, Date.now())]));
    const first = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    await waitFor(() => {
      expect(first.result.current.threads).toHaveLength(1);
    });
    first.unmount();

    useRole.mockReturnValue({ userId: "someone-else" });
    loadLocalCopy.mockReturnValue(new Promise(() => undefined));
    const second = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    expect(second.result.current.threads).toEqual([]);
  });

  it.each([
    ["another outing's copy", copyWith([], ALICE, "0190a000-0000-7000-8000-0000000000ee")],
    ["no copy", null],
  ])("lists the units for the next screen's first paint after %s", async (_name, copy) => {
    loadLocalCopy.mockResolvedValue(copy);
    readThread.mockImplementation((id: string) =>
      Promise.resolve(id === history(1).household.id ? history(1) : null),
    );
    const first = hook({ outingId: OUTING_ID, revisits: LIST, preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.unmount();

    loadLocalCopy.mockReturnValue(new Promise(() => undefined));
    const second = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
  });

  const ENDED = "0190a000-0000-7000-8000-0000000000ee";
  const nextScreen = () => {
    loadLocalCopy.mockReturnValue(new Promise(() => undefined));
    return hook({ outingId: null, revisits: undefined, preload: false, assumeCopyOuting: true });
  };

  it("hands on no thread of the session that ended, before one of the new is read", async () => {
    loadLocalCopy.mockResolvedValue({ ...copyWith([thread(1, Date.now())], ALICE, ENDED) });
    readThread.mockReturnValue(new Promise(() => undefined));
    const first = hook({ outingId: OUTING_ID, revisits: LIST, preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalled();
    });
    first.unmount();

    const second = nextScreen();
    expect(second.result.current.threads).toEqual([]);
  });

  it("reads a new session's units while a read for the one before is still out", async () => {
    const other = "0190a000-0000-7000-8000-0000000000ff";
    loadLocalCopy.mockResolvedValue(null);
    readThread.mockReturnValue(new Promise(() => undefined));
    const view = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 2), preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(2);
    });
    view.rerender({ outingId: other, revisits: LIST.slice(0, 2), preload: true });
    expect(view.result.current.threads).toEqual([]);
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(2 + 2);
    });
  });

  it("stops a read for the session that ended when another is told", async () => {
    const other = "0190a000-0000-7000-8000-0000000000ff";
    loadLocalCopy.mockResolvedValue(null);
    let release: (value: HouseholdHistory | null) => void = () => undefined;
    readThread.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    readThread.mockResolvedValue(null);
    const view = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(1);
    });
    view.rerender({ outingId: other, revisits: null, preload: true });
    await act(async () => {
      release(history(1));
      await Promise.resolve();
    });
    expect(updateLocalCopy).not.toHaveBeenCalled();
    expect(view.result.current.threads).toEqual([]);
  });

  it("reads a unit again when the copy took no thread of it, until the copy has the list", async () => {
    const disk: { copy: LocalCopy | null } = {
      copy: { ...copyWith([], ALICE, OUTING_ID), revisits: null },
    };
    loadLocalCopy.mockImplementation(() => Promise.resolve(disk.copy));
    updateLocalCopy.mockImplementation((change) => {
      disk.copy = change(disk.copy);
      return Promise.resolve();
    });
    readThread.mockImplementation((id: string) =>
      Promise.resolve([1, 2].map((n) => history(n)).find((h) => h.household.id === id) ?? null),
    );
    const first = LIST.slice(0, 2);
    const view = hook({ outingId: OUTING_ID, revisits: first, preload: true });
    await waitFor(() => {
      expect(ids(view.result.current.threads)).toEqual(["#05-01", "#05-02"]);
    });
    expect(disk.copy?.threads).toEqual([]);

    /* The list reaches the copy, and the screen's next read of it. */
    disk.copy = { ...copyWith([], ALICE, OUTING_ID), revisits: first };
    view.rerender({ outingId: OUTING_ID, revisits: [...first], preload: true });
    await waitFor(() => {
      expect(disk.copy?.threads.map((t) => t.history.household.unitNumber)).toEqual([
        "#05-01",
        "#05-02",
      ]);
    });
  });

  it("keeps the list it handed on when a later read of it fails", async () => {
    loadLocalCopy.mockResolvedValue(
      copyWith(
        [1, 2, 3].map((n) => thread(n, Date.now())),
        ALICE,
        OUTING_ID,
      ),
    );
    const first = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 2), preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01", "#05-02"]);
    });
    first.rerender({ outingId: OUTING_ID, revisits: null, preload: true });
    first.unmount();

    expect(ids(nextScreen().result.current.threads)).toEqual(["#05-01", "#05-02"]);
  });

  it("hands on the list a copy of another session's gave a read that then failed", async () => {
    loadLocalCopy.mockResolvedValue(copyWith([], ALICE, ENDED));
    readThread.mockImplementation((id: string) =>
      Promise.resolve(id === history(1).household.id ? history(1) : null),
    );
    const first = hook({ outingId: OUTING_ID, revisits: LIST, preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.rerender({ outingId: OUTING_ID, revisits: null, preload: true });
    /* A failed read leaves what was known on screen. */
    expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    first.unmount();

    expect(ids(nextScreen().result.current.threads)).toEqual(["#05-01"]);
  });

  it("hands on the list the screen read, not the older one in the copy", async () => {
    loadLocalCopy.mockResolvedValue({ ...copyWith([thread(1, Date.now())]), revisits: [] });
    const first = hook({ outingId: OUTING_ID, revisits: LIST, preload: false });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.unmount();

    loadLocalCopy.mockReturnValue(new Promise(() => undefined));
    const second = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
  });

  /* A copy as the disk holds it, taking what a screen keeps into it. */
  function disk(copy: LocalCopy | null, writes = true) {
    const held = { copy };
    loadLocalCopy.mockImplementation(() => Promise.resolve(held.copy));
    updateLocalCopy.mockImplementation((change) => {
      const next = change(held.copy);
      if (writes) held.copy = next;
      return Promise.resolve();
    });
    return held;
  }
  const readsOf = (...numbers: number[]) =>
    readThread.mockImplementation((id: string) =>
      Promise.resolve(numbers.map((n) => history(n)).find((h) => h.household.id === id) ?? null),
    );

  it("reads a unit the copy never takes once more, then waits for the copy to change", async () => {
    const held = disk({ ...copyWith([], ALICE, ENDED), revisits: null });
    readsOf(1, 2);
    const list = LIST.slice(0, 2);
    const view = hook({ outingId: OUTING_ID, revisits: list, preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(2);
    });
    for (let poll = 0; poll < 4; poll += 1) {
      view.rerender({ outingId: OUTING_ID, revisits: [...list], preload: true });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(readThread).toHaveBeenCalledTimes(2 + 2);

    /* The copy gains the session's list: the threads are read and written. */
    held.copy = { ...copyWith([], ALICE, OUTING_ID), revisits: list };
    view.rerender({ outingId: OUTING_ID, revisits: [...list], preload: true });
    await waitFor(() => {
      expect(held.copy?.threads).toHaveLength(2);
    });
    expect(readThread).toHaveBeenCalledTimes(2 + 2 + 2);
    view.rerender({ outingId: OUTING_ID, revisits: [...list], preload: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(readThread).toHaveBeenCalledTimes(2 + 2 + 2);
  });

  it("counts a unit as written only when it is on the copy's list", async () => {
    disk({ ...copyWith([], ALICE, OUTING_ID), revisits: LIST.slice(0, 1) });
    readsOf(1, 2);
    const list = LIST.slice(0, 2);
    const view = hook({ outingId: OUTING_ID, revisits: list, preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    view.rerender({ outingId: OUTING_ID, revisits: [...list], preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(3);
    });
    expect(readThread).toHaveBeenLastCalledWith(history(2).household.id);
  });

  it("never writes a thread into another member's copy", async () => {
    const held = disk({ ...copyWith([], "someone-else", OUTING_ID), revisits: LIST });
    readsOf(1);
    const view = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(ids(view.result.current.threads)).toEqual(["#05-01"]);
    });
    expect(held.copy?.threads).toEqual([]);
    expect(held.copy?.member.id).toBe("someone-else");
  });

  it("keeps a thread and the list memory holds when the screen's own read of the copy lands without them", async () => {
    disk({ ...copyWith([], ALICE, OUTING_ID), revisits: null });
    readsOf(1);
    const first = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.unmount();

    disk({ ...copyWith([], ALICE, OUTING_ID), revisits: [] });
    const second = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
  });

  it.each([
    ["the copy's, when it is newer", 1000, "Named on the copy"],
    ["memory's, when it is newer", -1000, "Named in memory"],
  ])("takes %s", async (_name, offset, expected) => {
    disk({ ...copyWith([], ALICE, OUTING_ID), revisits: null });
    readThread.mockResolvedValue({
      ...history(1),
      household: { ...history(1).household, name: "Named in memory" },
    });
    const first = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.unmount();

    const onCopy = thread(1, Date.now() + offset, {
      household: { ...history(1).household, name: "Named on the copy" },
    });
    disk(copyWith([onCopy], ALICE, OUTING_ID));
    const second = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(second.result.current.threads.map((t) => t.history.household.name)).toEqual([expected]);
  });

  it("keeps what memory handed on when there is no copy to read", async () => {
    disk(null);
    readsOf(1);
    const first = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.unmount();

    const second = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
  });

  it("never reads a unit again that the copy's own list does not name", async () => {
    disk({ ...copyWith([], ALICE, OUTING_ID), revisits: LIST.slice(0, 1) }, false);
    readsOf(1, 2);
    const list = LIST.slice(0, 2);
    const view = hook({ outingId: OUTING_ID, revisits: list, preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(2);
    });
    for (let poll = 0; poll < 5; poll += 1) {
      view.rerender({ outingId: OUTING_ID, revisits: [...list], preload: true });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    /* Unit 2 once more, as the copy's list does not name it; then none. */
    expect(readThread).toHaveBeenCalledTimes(2 + 1);
  });

  it("reads a unit again after a write that failed", async () => {
    updateLocalCopy.mockRejectedValue(new Error("quota"));
    loadLocalCopy.mockResolvedValue({ ...copyWith([], ALICE, OUTING_ID), revisits: LIST });
    readsOf(1);
    const list = LIST.slice(0, 1);
    const view = hook({ outingId: OUTING_ID, revisits: list, preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    view.rerender({ outingId: OUTING_ID, revisits: [...list], preload: true });
    await waitFor(() => {
      expect(readThread).toHaveBeenCalledTimes(2);
    });
  });

  it("drops a thread memory holds past its 12 hours when the copy read lands", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 13 * 60 * 60 * 1000);
    disk({ ...copyWith([], ALICE, OUTING_ID), revisits: null });
    readsOf(1);
    const first = hook({ outingId: OUTING_ID, revisits: LIST.slice(0, 1), preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-01"]);
    });
    first.unmount();
    vi.useRealTimers();

    disk(copyWith([], ALICE, OUTING_ID));
    const second = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(second.result.current.threads).toEqual([]);
  });

  it("never shows the threads memory holds for one session under the copy's other", async () => {
    disk({ ...copyWith([], ALICE, OUTING_ID), revisits: null });
    readsOf(2);
    const first = hook({ outingId: OUTING_ID, revisits: LIST.slice(1, 2), preload: true });
    await waitFor(() => {
      expect(ids(first.result.current.threads)).toEqual(["#05-02"]);
    });
    first.unmount();

    disk({ ...copyWith([thread(1, Date.now())], ALICE, ENDED), revisits: LIST });
    const second = hook({
      outingId: null,
      revisits: undefined,
      preload: false,
      assumeCopyOuting: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(ids(second.result.current.threads)).toEqual(["#05-01"]);
  });
});
