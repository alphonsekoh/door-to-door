import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAllUsers } from "@/lib/users";
import type * as ApiClientModule from "@/lib/api-client";

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

describe("loadAllUsers", () => {
  it("walks every page rather than stopping at the first", async () => {
    apiFetch
      .mockResolvedValueOnce(page(["a", "b"], true))
      .mockResolvedValueOnce(page(["c"], false));
    const users = await loadAllUsers(2);
    expect(users.map((user) => user.id)).toEqual(["a", "b", "c"]);
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/users?limit=2&offset=0");
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/users?limit=2&offset=2");
  });

  it("stops on an empty page even if the server claims there is more", async () => {
    apiFetch.mockResolvedValueOnce(page(["a"], true)).mockResolvedValueOnce(page([], true));
    expect((await loadAllUsers(2)).map((user) => user.id)).toEqual(["a"]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("asks for 100 a page by default", async () => {
    apiFetch.mockResolvedValueOnce(page([], false));
    await loadAllUsers();
    expect(apiFetch).toHaveBeenCalledWith("/users?limit=100&offset=0");
  });
});
