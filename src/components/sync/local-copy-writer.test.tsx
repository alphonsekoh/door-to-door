import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalCopyWriter } from "@/components/sync/local-copy-writer";
import type { ActiveSession } from "@/generated/types.gen";
import type { LocalCopy } from "@/lib/offline/local-copy";

const { useRole, useSession, updateLocalCopy } = vi.hoisted(() => ({
  useRole: vi.fn(),
  useSession: vi.fn(),
  updateLocalCopy: vi.fn<(change: (copy: LocalCopy | null) => LocalCopy | null) => Promise<void>>(),
}));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));
vi.mock("next-auth/react", () => ({ useSession }));
vi.mock("@/lib/offline/local-copy-store", () => ({ updateLocalCopy }));

const ALICE = "0190a000-0000-7000-8000-00000000000a";
const BLOCK = "0190a000-0000-7000-8000-000000000123";
const STAMP = "2026-10-15T09:00:00.000Z";

const active: ActiveSession = {
  session: {
    id: "0190a000-0000-7000-8000-0000000000cc",
    title: "Thursday evening",
    kind: "regular",
    status: "active",
    startedAt: STAMP,
    endedAt: null,
    createdBy: { id: ALICE, name: "Admin" },
    createdAt: STAMP,
  },
  blocks: [
    {
      block: {
        id: BLOCK,
        name: "123",
        street: "Ang Mo Kio Ave 3",
        postalCode: null,
        createdAt: STAMP,
      },
      visitCount: 0,
      householdCount: 0,
      activeMembers: [],
    },
  ],
  householdIds: [],
};

function signedIn(user: { name?: string | null; email?: string | null } | null) {
  useRole.mockReturnValue({ userId: user === null ? undefined : ALICE });
  useSession.mockReturnValue({ data: user === null ? null : { user: { id: ALICE, ...user } } });
}

/* What the writer's change makes of an empty copy. */
function written(): LocalCopy | null {
  const change = updateLocalCopy.mock.calls[0]?.[0];
  return change === undefined ? null : change(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  updateLocalCopy.mockResolvedValue(undefined);
});

describe("useLocalCopyWriter", () => {
  it("notes the outing under the signed-in member's name", () => {
    signedIn({ name: "Alice Tan", email: "alice@example.com" });
    renderHook(() => useLocalCopyWriter()).result.current.noteOuting(active);
    expect(written()).toMatchObject({
      member: { id: ALICE, name: "Alice Tan" },
      outing: active.session,
    });
  });

  it("falls back to the email for a member with no name", () => {
    signedIn({ name: null, email: "alice@example.com" });
    renderHook(() => useLocalCopyWriter()).result.current.noteOuting(null);
    expect(written()).toMatchObject({ member: { name: "alice@example.com" }, outing: null });
  });

  it("notes a block with its units", () => {
    signedIn({ name: "Alice Tan" });
    renderHook(() => useLocalCopyWriter()).result.current.noteBlock(active, BLOCK, []);
    expect(written()?.blocks.map((b) => b.block.id)).toEqual([BLOCK]);
  });

  it.each([
    ["before the session has loaded", null],
    ["for a member with neither name nor email", { name: null, email: null }],
  ])("writes nothing %s", (_, user) => {
    signedIn(user);
    const { result } = renderHook(() => useLocalCopyWriter());
    result.current.noteOuting(active);
    result.current.noteBlock(active, BLOCK, []);
    expect(updateLocalCopy).not.toHaveBeenCalled();
  });

  it("swallows a write that fails: the screen working matters more", async () => {
    signedIn({ name: "Alice Tan" });
    updateLocalCopy.mockRejectedValue(new Error("quota"));
    renderHook(() => useLocalCopyWriter()).result.current.noteOuting(active);
    await Promise.resolve();
    expect(updateLocalCopy).toHaveBeenCalledOnce();
  });

  it("hands out new callbacks once the member is known, so screens write again", () => {
    signedIn(null);
    const { result, rerender } = renderHook(() => useLocalCopyWriter());
    const before = result.current.noteOuting;
    rerender();
    expect(result.current.noteOuting).toBe(before);
    signedIn({ name: "Alice Tan" });
    rerender();
    expect(result.current.noteOuting).not.toBe(before);
  });
});
