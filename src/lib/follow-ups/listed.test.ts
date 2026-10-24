import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { loadAllListed } from "@/lib/follow-ups/listed";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const page = (ids: string[], hasMore: boolean) => ({
  data: ids.map((id) => ({ id })),
  pagination: { limit: 2, offset: 0, total: 99, hasMore },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadAllListed", () => {
  it("walks every page of what is still owed", async () => {
    apiFetch
      .mockResolvedValueOnce(page(["a", "b"], true))
      .mockResolvedValueOnce(page(["c"], false));
    expect((await loadAllListed(2)).map((note) => note.id)).toEqual(["a", "b", "c"]);
    expect(apiFetch.mock.calls.map(([path]) => String(path))).toEqual([
      "/follow-ups?status=listed&outstanding=true&limit=2&offset=0",
      "/follow-ups?status=listed&outstanding=true&limit=2&offset=2",
    ]);
  });

  it("stops on an empty page, so a miscounting server cannot loop it", async () => {
    apiFetch.mockResolvedValueOnce(page(["a"], true)).mockResolvedValueOnce(page([], true));
    expect(await loadAllListed()).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
