import "fake-indexeddb/auto";
import { render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalCopyKeeper } from "@/components/local-copy-keeper";
import type { LocalCopy } from "@/lib/offline/local-copy";
import { loadLocalCopy, updateLocalCopy } from "@/lib/offline/local-copy-store";

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const ALICE = "0190a000-0000-7000-8000-00000000000a";
const BEN = "0190a000-0000-7000-8000-00000000000b";

const alicesCopy: LocalCopy = {
  v: 1,
  member: { id: ALICE, name: "Alice Tan" },
  savedAt: Date.now(),
  outing: null,
  blocks: [],
};

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  await updateLocalCopy(() => alicesCopy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalCopyKeeper", () => {
  it("forgets the copy when someone else is signed in", async () => {
    useRole.mockReturnValue({ userId: BEN });
    render(<LocalCopyKeeper />);
    await waitFor(async () => {
      expect(await loadLocalCopy()).toBeNull();
    });
  });

  it("keeps the copy of the member who is signed in", async () => {
    useRole.mockReturnValue({ userId: ALICE });
    render(<LocalCopyKeeper />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await loadLocalCopy()).toEqual(alicesCopy);
  });

  it("keeps it while nobody is known to be signed in, as offline", async () => {
    useRole.mockReturnValue({ userId: undefined });
    render(<LocalCopyKeeper />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await loadLocalCopy()).toEqual(alicesCopy);
  });

  it("says nothing when the copy cannot be reached", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("blocked");
      },
    });
    useRole.mockReturnValue({ userId: BEN });
    expect(() => render(<LocalCopyKeeper />)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
