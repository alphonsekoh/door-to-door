import { beforeEach, describe, expect, it, vi } from "vitest";
import { zListHouseholdsQuery } from "@/generated/zod.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { MAX_OFFSET, loadAllHouseholds } from "@/lib/households/pages";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const BLOCK = "00000000-0000-4000-8001-000000000001";

const unit = (id: string, unitNumber = id) => ({ household: { id, unitNumber } });
const page = (units: ReturnType<typeof unit>[], hasMore: boolean) => ({
  data: units,
  pagination: { limit: 2, offset: 0, total: 99, hasMore },
});
const paths = () => apiFetch.mock.calls.map(([path]) => String(path));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadAllHouseholds", () => {
  it("reads every page of the block, in the server's order", async () => {
    apiFetch
      .mockResolvedValueOnce(page([unit("a"), unit("b")], true))
      .mockResolvedValueOnce(page([unit("c")], false));
    const units = await loadAllHouseholds(BLOCK, 2);
    expect(units.map((u) => u.household.id)).toEqual(["a", "b", "c"]);
    expect(paths()).toEqual([
      `/households?blockId=${BLOCK}&limit=2&offset=0`,
      `/households?blockId=${BLOCK}&limit=2&offset=2`,
    ]);
  });

  it("asks for a hundred a page unless told otherwise", async () => {
    apiFetch.mockResolvedValueOnce(page([unit("a")], false));
    await loadAllHouseholds(BLOCK);
    expect(paths()).toEqual([`/households?blockId=${BLOCK}&limit=100&offset=0`]);
  });

  it("encodes the block id rather than trusting it", async () => {
    apiFetch.mockResolvedValueOnce(page([], false));
    await loadAllHouseholds("b1&limit=1", 2);
    expect(paths()).toEqual(["/households?blockId=b1%26limit%3D1&limit=2&offset=0"]);
  });

  it("keeps a household once, where it first came, with the copy read last", async () => {
    // A unit added ahead of it pushes it onto the next page.
    apiFetch
      .mockResolvedValueOnce(page([unit("a"), unit("b")], true))
      .mockResolvedValueOnce(page([unit("b", "#02-02 again"), unit("c")], false));
    const units = await loadAllHouseholds(BLOCK, 2);
    expect(units.map((u) => [u.household.id, u.household.unitNumber])).toEqual([
      ["a", "a"],
      ["b", "#02-02 again"],
      ["c", "c"],
    ]);
    // The offset counts what the server sent, so the next page starts where it left off.
    expect(paths()[1]).toBe(`/households?blockId=${BLOCK}&limit=2&offset=2`);
  });

  it("stops on an empty page, so a miscounting server cannot loop it", async () => {
    apiFetch.mockResolvedValueOnce(page([unit("a")], true)).mockResolvedValueOnce(page([], true));
    expect(await loadAllHouseholds(BLOCK, 100)).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("reads the page at the contract's largest offset, and none past it", async () => {
    // A server that always says there is more, as a block flooded with units would.
    apiFetch.mockImplementation((path: string) => {
      const from = Number(new URLSearchParams(path.split("?")[1]).get("offset"));
      return Promise.resolve(
        page(
          Array.from({ length: 100 }, (_, i) => unit(String(from + i))),
          true,
        ),
      );
    });
    const units = await loadAllHouseholds(BLOCK);
    expect(units).toHaveLength(MAX_OFFSET + 100);
    expect(apiFetch).toHaveBeenCalledTimes(MAX_OFFSET / 100 + 1);
    expect(paths().at(-1)).toBe(
      `/households?blockId=${BLOCK}&limit=100&offset=${String(MAX_OFFSET)}`,
    );
  });

  it("fails as a whole when any page fails", async () => {
    apiFetch
      .mockResolvedValueOnce(page([unit("a")], true))
      .mockRejectedValueOnce(new TypeError("offline"));
    await expect(loadAllHouseholds(BLOCK, 100)).rejects.toThrow("offline");
  });
});

describe("MAX_OFFSET", () => {
  it("is the contract's own bound on offset", () => {
    expect(zListHouseholdsQuery.safeParse({ blockId: BLOCK, offset: MAX_OFFSET }).success).toBe(
      true,
    );
    expect(zListHouseholdsQuery.safeParse({ blockId: BLOCK, offset: MAX_OFFSET + 1 }).success).toBe(
      false,
    );
  });
});
