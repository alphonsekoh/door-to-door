import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { loadAllFollowUps } from "@/lib/follow-ups/pages";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const page = (notes: { id: string; note?: string }[], hasMore: boolean) => ({
  data: notes,
  pagination: { limit: 2, offset: 0, total: 99, hasMore },
});
const ids = (...names: string[]) => names.map((id) => ({ id }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadAllFollowUps", () => {
  it("walks every page of the query, in the server's order", async () => {
    apiFetch
      .mockResolvedValueOnce(page(ids("a", "b"), true))
      .mockResolvedValueOnce(page(ids("c"), false));
    const notes = await loadAllFollowUps({ status: "listed", outstanding: "true" }, 2);
    expect(notes.map((note) => note.id)).toEqual(["a", "b", "c"]);
    expect(apiFetch.mock.calls.map(([path]) => String(path))).toEqual([
      "/follow-ups?status=listed&outstanding=true&limit=2&offset=0",
      "/follow-ups?status=listed&outstanding=true&limit=2&offset=2",
    ]);
  });

  it("keeps a note once, where it first came, when a note added ahead of it pushes it onto the next page", async () => {
    apiFetch
      .mockResolvedValueOnce(page(ids("a", "b"), true))
      .mockResolvedValueOnce(page([{ id: "b", note: "read again" }, { id: "c" }], true))
      .mockResolvedValueOnce(page(ids("d"), false));
    const notes = await loadAllFollowUps({}, 2);
    expect(notes.map((note) => note.id)).toEqual(["a", "b", "c", "d"]);
    // The offset counts what the server sent, so the next page starts where it left off.
    expect(String(apiFetch.mock.calls[2]?.[0])).toBe("/follow-ups?limit=2&offset=4");
  });

  it("stops on an empty page, so a miscounting server cannot loop it", async () => {
    apiFetch.mockResolvedValueOnce(page(ids("a"), true)).mockResolvedValueOnce(page([], true));
    expect(await loadAllFollowUps({}, 100)).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("fails as a whole when any page fails", async () => {
    apiFetch
      .mockResolvedValueOnce(page(ids("a"), true))
      .mockRejectedValueOnce(new TypeError("offline"));
    await expect(loadAllFollowUps({}, 100)).rejects.toThrow("offline");
  });
});
