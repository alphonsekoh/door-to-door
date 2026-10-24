import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUp } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import {
  DECLINED_WINDOW_MS,
  authorNoticeLine,
  loadRemovalsForAuthor,
  removedForAuthor,
} from "@/lib/follow-ups/declined";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const NOW = Date.parse("2026-10-23T10:00:00.000Z");
const ALICE = { id: "alice", name: "Alice", image: null };
const ADMIN = { id: "admin", name: "Ben Lim", image: null };

function removed(id: string, overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id,
    householdId: "h1",
    blockId: "b1",
    blockName: "123",
    unitNumber: "#05-123",
    visitId: null,
    status: "suggested",
    author: ALICE,
    note: "Asked us back",
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: new Date(NOW - 60_000).toISOString(),
    deletedBy: ADMIN,
    deleteReason: "Already visited",
    waitingSuggestionBy: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

/* Local midday, so the day reads the same in any time zone the suite runs in. */
const MARCH_3 = new Date(2026, 2, 3, 12).toISOString();

const page = (ids: string[], hasMore: boolean) => ({
  data: ids.map((id) => removed(id)),
  pagination: { limit: 2, offset: 0, total: 99, hasMore },
});

describe("loadRemovalsForAuthor", () => {
  it("asks the server for removals by others in the last thirty days, page by page", async () => {
    apiFetch
      .mockResolvedValueOnce(page(["a", "b"], true))
      .mockResolvedValueOnce(page(["c", "d"], true))
      .mockResolvedValueOnce(page(["e"], false));
    const notes = await loadRemovalsForAuthor("alice", NOW, 2);
    expect(notes.map((note) => note.id)).toEqual(["a", "b", "c", "d", "e"]);

    const since = new Date(NOW - DECLINED_WINDOW_MS).toISOString();
    const asked = apiFetch.mock.calls.map(([path]) => new URL(String(path), "https://t.local"));
    expect(asked.map((url) => url.pathname)).toEqual(["/follow-ups", "/follow-ups", "/follow-ups"]);
    expect(asked.map((url) => Object.fromEntries(url.searchParams))).toEqual(
      ["0", "2", "4"].map((offset) => ({
        deleted: "true",
        authorId: "alice",
        removedByOthers: "true",
        deletedSince: since,
        limit: "2",
        offset,
      })),
    );
  });

  it("reads a hundred at a time unless told otherwise", async () => {
    apiFetch.mockResolvedValueOnce(page(["a"], false));
    await loadRemovalsForAuthor("alice", NOW);
    expect(String(apiFetch.mock.calls[0]?.[0])).toContain("limit=100&offset=0");
  });

  it("stops on an empty page, so a miscounting server cannot loop it", async () => {
    apiFetch.mockResolvedValueOnce(page(["a"], true)).mockResolvedValueOnce(page([], true));
    expect(await loadRemovalsForAuthor("alice", NOW)).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("fails as a whole when any page fails", async () => {
    apiFetch
      .mockResolvedValueOnce(page(["a"], true))
      .mockRejectedValueOnce(new TypeError("offline"));
    await expect(loadRemovalsForAuthor("alice", NOW)).rejects.toThrow("offline");
  });
});

describe("removedForAuthor", () => {
  it("keeps what this phone has not been told, in the server's order", () => {
    const notes = [
      removed("newest"),
      removed("seen"),
      removed("taken off the list", { status: "listed" }),
      removed("live", { deletedAt: null, deletedBy: null }),
    ];
    expect(removedForAuthor(notes, new Set(["seen"])).map((n) => n.id)).toEqual([
      "newest",
      "taken off the list",
    ]);
  });
});

describe("authorNoticeLine", () => {
  it("says a suggestion was declined, by whom, when and why", () => {
    expect(
      authorNoticeLine({
        status: "suggested",
        deletedAt: MARCH_3,
        deletedBy: ADMIN,
        deleteReason: "Already visited",
      }),
    ).toBe("Declined by Ben Lim · 3 Mar 2026: Already visited");
  });

  it("says a listed note was taken off the follow-up list", () => {
    expect(
      authorNoticeLine({
        status: "listed",
        deletedAt: MARCH_3,
        deletedBy: ADMIN,
        deleteReason: "The family has moved",
      }),
    ).toBe("Removed from the follow-up list by Ben Lim · 3 Mar 2026: The family has moved");
  });

  it("leaves the reason off a removal made before one was required", () => {
    expect(
      authorNoticeLine({
        status: "suggested",
        deletedAt: MARCH_3,
        deletedBy: null,
        deleteReason: null,
      }),
    ).toBe("Declined by Someone · 3 Mar 2026");
  });
});
