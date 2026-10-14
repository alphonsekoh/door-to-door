import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsolidatedHistory } from "@/components/consolidated-history";
import type { HistoryEntry, InterestLevel } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { replace, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: { value: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams.value,
}));

vi.mock("@/lib/use-role", () => ({
  useRole: () => ({
    userId: "admin",
    role: "admin",
    isAdmin: true,
    isMember: false,
    isLoading: false,
    isSignedIn: true,
  }),
}));

const AT = "2026-03-14T11:00:00.000Z";

function entry(
  householdId: string,
  options: {
    unitNumber?: string;
    createdAt?: string;
    interestLevel?: InterestLevel;
    sessionTitle?: string;
    description?: string;
    team?: HistoryEntry["visit"]["team"];
  } = {},
): HistoryEntry {
  const {
    unitNumber = "#05-123",
    createdAt = AT,
    interestLevel = "low",
    sessionTitle = "March outing",
    description = "",
    team = null,
  } = options;
  return {
    visit: {
      id: `v-${householdId}-${createdAt}`,
      householdId,
      sessionId: "s1",
      member: { id: "u1", name: "Alice", image: null },
      team,
      interestLevel,
      description,
      clientCreatedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    },
    household: {
      id: householdId,
      blockId: "b1",
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt,
      updatedAt: createdAt,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt },
    session: {
      id: "s1",
      title: sessionTitle,
      status: "ended",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt,
    },
  };
}

/* The outing picker holds the same titles as the rows, so assertions about a
   door are scoped to that door's card. */
async function card(unit: string): Promise<HTMLElement> {
  const heading = await screen.findByText(unit);
  const row = heading.closest("li");
  if (!row) throw new Error(`no card for ${unit}`);
  return row;
}

const pickers = {
  blocks: {
    data: [{ id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT }],
    pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
  },
  sessions: {
    data: [
      {
        id: "s1",
        title: "March outing",
        status: "ended",
        startedAt: null,
        endedAt: null,
        createdBy: { id: "admin", name: "Admin", image: null },
        createdAt: AT,
      },
    ],
    pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
  },
  users: {
    data: [
      {
        id: "u1",
        email: "alice@t.local",
        name: "Alice",
        image: null,
        role: "member",
        deactivatedAt: null,
        createdAt: AT,
      },
    ],
    pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
  },
};

const TEAM_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const teamsOf = (sessionId: string, name: string) => ({
  data: [{ id: TEAM_ID, sessionId, name, members: [], createdAt: AT }],
});

function serve(entries: HistoryEntry[], total = entries.length) {
  apiFetch.mockImplementation((path: string) => {
    if (path === "/sessions/s1/teams") return Promise.resolve(teamsOf("s1", "Alice & Ben"));
    if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
    if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
    if (path.startsWith("/users")) return Promise.resolve(pickers.users);
    return Promise.resolve({
      data: entries,
      pagination: { limit: 100, offset: 0, total, hasMore: entries.length < total },
    });
  });
}

let csv = "";

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
  csv = "";
  /* jsdom has no object URLs and cannot follow a download, so the blob is
     captured here instead - which is also the only way to assert its contents. */
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:stub");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "Blob").mockImplementation(function MockBlob(parts: BlobPart[]) {
    csv = parts.map(String).join("");
    return { size: csv.length, type: "text/csv" } as unknown as Blob;
  } as unknown as typeof Blob);
});

describe("ConsolidatedHistory", () => {
  it("puts every visit to one door on one row", async () => {
    // The consolidated timeline: March and August are one unit, not two rows.
    serve([
      entry("h1", { createdAt: "2026-03-01T10:00:00.000Z", interestLevel: "low" }),
      entry("h1", {
        createdAt: "2026-08-01T10:00:00.000Z",
        interestLevel: "high",
        sessionTitle: "August outing",
      }),
    ]);
    render(<ConsolidatedHistory />);

    const row = await card("Blk 123, #05-123");
    expect(within(row).getByText("2 visits")).toBeInTheDocument();
    expect(within(row).getByText(/March outing/)).toBeInTheDocument();
    expect(within(row).getByText(/August outing/)).toBeInTheDocument();
  });

  it("asks for the first page with no filters by default", async () => {
    serve([]);
    render(<ConsolidatedHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/history?limit=100&offset=0");
    });
  });

  it("reads its filters from the URL", async () => {
    searchParams.value = new URLSearchParams("religion=buddhist&from=2026-03-01");
    serve([]);
    render(<ConsolidatedHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/history?limit=100&offset=0&religion=buddhist&from=2026-03-01T00%3A00%3A00.000Z",
      );
    });
  });

  it("writes each filter back to the URL", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-123");

    await user.selectOptions(screen.getByLabelText("Filter by religion"), "hindu");
    expect(replace).toHaveBeenCalledWith("/admin/history?religion=hindu");

    await user.selectOptions(screen.getByLabelText("Filter by outing"), "s1");
    expect(replace).toHaveBeenCalledWith("/admin/history?sessionId=s1");
  });

  it("wires every control to its own parameter", async () => {
    // Each select writes a different key; crossing two of them silently
    // filters by the wrong thing and still looks like it worked.
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-123");

    await user.selectOptions(screen.getByLabelText("Filter by block"), "b1");
    expect(replace).toHaveBeenLastCalledWith("/admin/history?blockId=b1");

    await user.selectOptions(screen.getByLabelText("Filter by member"), "u1");
    expect(replace).toHaveBeenLastCalledWith("/admin/history?memberId=u1");

    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    expect(replace).toHaveBeenLastCalledWith("/admin/history?interestLevel=high");

    await user.type(screen.getByLabelText("Recorded from"), "2026-03-01");
    expect(replace).toHaveBeenLastCalledWith("/admin/history?from=2026-03-01");

    await user.type(screen.getByLabelText("Recorded to"), "2026-03-31");
    expect(replace).toHaveBeenLastCalledWith("/admin/history?to=2026-03-31");

    await user.type(screen.getByLabelText("Search by unit, name or contact"), "t");
    expect(replace).toHaveBeenLastCalledWith("/admin/history?q=t");
  });

  it("reloads after amending, so the row is not stale", async () => {
    const user = userEvent.setup();
    serve([entry("h1", { interestLevel: "low" })]);
    render(<ConsolidatedHistory />);
    const row = await card("Blk 123, #05-123");

    await user.click(within(row).getByRole("button"));
    await user.click(screen.getByRole("radio", { name: "High" }));

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      if (path.startsWith("/visits/")) return Promise.resolve({});
      return Promise.resolve({
        data: [entry("h1", { interestLevel: "high" })],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(within(await card("Blk 123, #05-123")).getByText("High")).toBeInTheDocument();
  });

  it("closes the amend sheet without reloading when abandoned", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    const row = await card("Blk 123, #05-123");

    await user.click(within(row).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears back to a bare URL", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("religion=hindu");
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(replace).toHaveBeenCalledWith("/admin/history");
  });

  it("searches within what is loaded", async () => {
    searchParams.value = new URLSearchParams("q=124");
    serve([entry("h1"), entry("h2", { unitNumber: "#05-124" })]);
    render(<ConsolidatedHistory />);

    expect(await screen.findByText("Blk 123, #05-124")).toBeInTheDocument();
    expect(screen.queryByText("Blk 123, #05-123")).not.toBeInTheDocument();
  });

  it("appends the next page rather than replacing it", async () => {
    const user = userEvent.setup();
    serve([entry("h1")], 2);
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-123");

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [entry("h2", { unitNumber: "#05-124" })],
        pagination: { limit: 100, offset: 100, total: 2, hasMore: false },
      });
    });
    await user.click(screen.getByRole("button", { name: /Show more/ }));

    expect(await screen.findByText("Blk 123, #05-124")).toBeInTheDocument();
    expect(screen.getByText("Blk 123, #05-123")).toBeInTheDocument();
  });

  it("exports the whole filtered set, not the page on screen", async () => {
    // The promise of the button. A file holding the first hundred rows while
    // the filter matched three hundred would be worse than no export.
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("religion=buddhist");
    const first = Array.from({ length: 100 }, (_, i) =>
      entry(`h${String(i)}`, { unitNumber: `#05-${String(i)}` }),
    );
    let requested: string[] = [];
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      requested.push(path);
      const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset"));
      return Promise.resolve(
        offset === 0
          ? { data: first, pagination: { limit: 100, offset, total: 101, hasMore: true } }
          : {
              data: [entry("last", { unitNumber: "#09-99" })],
              pagination: { limit: 100, offset, total: 101, hasMore: false },
            },
      );
    });

    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-0");

    requested = [];
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("Exported 101 records.")).toBeInTheDocument();
    // Every request carried the filter, and the second one carried the offset.
    expect(requested.every((path) => path.includes("religion=buddhist"))).toBe(true);
    expect(requested.some((path) => path.includes("offset=100"))).toBe(true);
    expect(csv).toContain("#09-99");
  });

  it("applies the search term to the export as well as the screen", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("q=124");
    serve([entry("h1"), entry("h2", { unitNumber: "#05-124" })]);
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-124");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("Exported 1 records.")).toBeInTheDocument();
    expect(csv).toContain("#05-124");
    expect(csv).not.toContain("#05-123");
  });

  it("says so rather than quietly truncating a very large export", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 100000, hasMore: true },
      });
    });
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText(/Narrow the filters to get the rest/)).toBeInTheDocument();
  });

  it("reports an export that failed instead of writing an empty file", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-123");

    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("Could not reach the server.")).toBeInTheDocument();
  });

  it("says when the filters match nothing", async () => {
    serve([]);
    render(<ConsolidatedHistory />);
    expect(await screen.findByText("Nothing matches those filters.")).toBeInTheDocument();
  });

  it("amends any historical record", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText("Blk 123, #05-123");

    const row = await card("Blk 123, #05-123");
    await user.click(within(row).getByRole("button"));
    expect(screen.getByRole("dialog", { name: "Amend #05-123" })).toBeInTheDocument();
  });

  it("still lists records when a picker cannot be loaded", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/sessions")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/users")) return Promise.reject(new Error("nope"));
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<ConsolidatedHistory />);

    expect(await screen.findByText("Blk 123, #05-123")).toBeInTheDocument();
  });

  it("offers a retry when the records fail to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<ConsolidatedHistory />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");

    serve([entry("h1")]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Blk 123, #05-123")).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<ConsolidatedHistory />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the records.");
  });
});

describe("teams", () => {
  const PAIR = {
    id: TEAM_ID,
    name: "Alice & Ben",
    members: [{ id: "u2", name: "Ben Lim", image: null }],
  };

  it("names the author, teammates and team on every visit", async () => {
    serve([entry("h1", { team: PAIR })]);
    render(<ConsolidatedHistory />);

    const row = await card("Blk 123, #05-123");
    expect(within(row).getByText("By Alice with Ben Lim")).toBeInTheDocument();
    expect(within(row).getByText("Team: Alice & Ben")).toBeInTheDocument();
  });

  it("offers no team filter until an outing is chosen", async () => {
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    expect(screen.queryByLabelText("Filter by team")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/teams"));
  });

  it("lists the chosen outing's teams and writes the choice to the URL", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("sessionId=s1");
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);

    const picker = await screen.findByLabelText("Filter by team");
    await waitFor(() => {
      expect(within(picker).getByRole("option", { name: "Alice & Ben" })).toBeInTheDocument();
    });
    await user.selectOptions(picker, TEAM_ID);
    expect(replace).toHaveBeenCalledWith(`/admin/history?sessionId=s1&teamId=${TEAM_ID}`);
  });

  it("asks the server for that team's records", async () => {
    searchParams.value = new URLSearchParams(`sessionId=s1&teamId=${TEAM_ID}`);
    serve([]);
    render(<ConsolidatedHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/history?limit=100&offset=0&sessionId=s1&teamId=${TEAM_ID}`,
      );
    });
  });

  it("forgets the team when the outing changes", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams(`sessionId=s1&teamId=${TEAM_ID}`);
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    await user.selectOptions(screen.getByLabelText("Filter by outing"), "");
    expect(replace).toHaveBeenCalledWith("/admin/history");
  });

  it("leaves the team picker empty when the teams cannot be listed", async () => {
    searchParams.value = new URLSearchParams("sessionId=s1");
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith("/teams")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    expect(screen.getByLabelText("Filter by team").querySelectorAll("option")).toHaveLength(1);
  });

  it("never shows a previous outing's teams after a quick switch", async () => {
    const late: { s1: (value: unknown) => void; fail: (error: unknown) => void } = {
      s1: () => undefined,
      fail: () => undefined,
    };
    searchParams.value = new URLSearchParams("sessionId=s1");
    apiFetch.mockImplementation((path: string) => {
      if (path === "/sessions/s1/teams") {
        return new Promise((resolve) => {
          late.s1 = resolve;
        });
      }
      if (path === "/sessions/s2/teams") return Promise.resolve(teamsOf("s2", "Second pair"));
      if (path === "/sessions/s3/teams") {
        return new Promise((_resolve, reject) => {
          late.fail = reject;
        });
      }
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    const { rerender } = render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });

    searchParams.value = new URLSearchParams("sessionId=s3");
    rerender(<ConsolidatedHistory />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s3/teams");
    });
    searchParams.value = new URLSearchParams("sessionId=s2");
    rerender(<ConsolidatedHistory />);
    const picker = await screen.findByLabelText("Filter by team");
    await waitFor(() => {
      expect(within(picker).getByRole("option", { name: "Second pair" })).toBeInTheDocument();
    });

    await act(async () => {
      late.s1(teamsOf("s1", "Old pair"));
      late.fail(new Error("late"));
      await Promise.resolve();
    });
    expect(within(picker).queryByRole("option", { name: "Old pair" })).not.toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Second pair" })).toBeInTheDocument();
  });

  it("exports the team and teammates", async () => {
    const user = userEvent.setup();
    serve([entry("h1", { team: PAIR })]);
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => {
      expect(csv).toContain("Alice,Alice & Ben,Ben Lim,March outing");
    });
  });
});
