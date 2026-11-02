import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import type { FollowUp } from "@/generated/types.gen";
import { groupListedByHousehold, loadAllListed } from "@/lib/follow-ups/listed";
import { groupForPicking, householdIdsOf } from "@/lib/follow-ups/pick";

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

  it("reads a hundred at a time unless told otherwise", async () => {
    apiFetch.mockResolvedValueOnce(page(["a"], false));
    await loadAllListed();
    expect(String(apiFetch.mock.calls[0]?.[0])).toContain("limit=100&offset=0");
  });
});

describe("groupListedByHousehold", () => {
  const listed = (id: string, householdId: string, blockName = "123") =>
    ({
      id,
      householdId,
      blockId: `b-${blockName}`,
      blockName,
      unitNumber: `#0${householdId}`,
    }) as FollowUp;
  /* The server's order, soonest due first: h2 carries two listed notes. */
  const notes = [
    listed("n1", "h2"),
    listed("n2", "h1"),
    listed("n3", "h2"),
    listed("n4", "h3", "9"),
    listed("n5", "h4"),
  ];

  it("makes a household with two listed notes one entry, its notes in order", () => {
    const groups = groupListedByHousehold(notes);
    expect(groups.map((group) => [group.householdId, group.notes.map((note) => note.id)])).toEqual([
      ["h2", ["n1", "n3"]],
      ["h1", ["n2"]],
      ["h3", ["n4"]],
      ["h4", ["n5"]],
    ]);
    expect(groups[0]).toMatchObject({ blockName: "123", unitNumber: "#0h2" });
  });

  it("counts what the New session picker counts", () => {
    expect(groupListedByHousehold(notes)).toHaveLength(
      householdIdsOf(groupForPicking(notes)).length,
    );
    expect(groupListedByHousehold(notes)).toHaveLength(4);
  });
});
