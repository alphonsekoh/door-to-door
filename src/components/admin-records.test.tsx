import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRecords } from "@/components/admin-records";
import type { HistoryEntry, InterestLevel } from "@/generated/types.gen";

const { apiFetch, ApiRequestError } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  ApiRequestError: class extends Error {
    status: number;
    code: string;
    constructor(status: number) {
      super("not found");
      this.status = status;
      this.code = "not_found";
    }
  },
}));
vi.mock("@/lib/api-client", () => ({ apiFetch, ApiRequestError }));

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
  unitNumber: string,
  options: {
    member?: string;
    interestLevel?: InterestLevel;
    name?: string | null;
    team?: HistoryEntry["visit"]["team"];
  } = {},
): HistoryEntry {
  const { member = "Alice", interestLevel = "low", name = null, team = null } = options;
  return {
    visit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId: "s1",
      member: { id: "u1", name: member, image: null },
      team,
      interestLevel,
      description: "",
      clientCreatedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
    household: {
      id: `h-${unitNumber}`,
      blockId: "b1",
      unitNumber,
      name,
      contact: null,
      religion: null,
      createdAt: AT,
      updatedAt: AT,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
    session: {
      id: "s1",
      title: "June outing",
      status: "active",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: AT,
    },
  };
}

const activeSession = {
  session: {
    id: "s1",
    title: "June outing",
    status: "active",
    startedAt: null,
    endedAt: null,
    createdBy: { id: "admin", name: "Admin", image: null },
    createdAt: AT,
  },
  blocks: [
    {
      block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
      visitCount: 1,
      householdCount: 1,
      activeMembers: [],
    },
  ],
};

const userPage = {
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
};

const TEAM_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const teamList = {
  data: [
    {
      id: TEAM_ID,
      sessionId: "s1",
      name: "Alice & Ben",
      members: [
        { id: "u1", name: "Alice", image: null },
        { id: "u2", name: "Ben", image: null },
      ],
      createdAt: AT,
    },
  ],
};

function serve(entries: HistoryEntry[], total = entries.length) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
    if (path === "/sessions/s1/teams") return Promise.resolve(teamList);
    if (path.startsWith("/users")) return Promise.resolve(userPage);
    return Promise.resolve({
      data: entries,
      pagination: { limit: 100, offset: 0, total, hasMore: entries.length < total },
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
});

describe("AdminRecords", () => {
  it("lists every member's records for the running outing", async () => {
    serve([entry("#05-123"), entry("#05-124", { member: "Ben" })]);
    render(<AdminRecords />);

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    expect(screen.getByText("By Ben")).toBeInTheDocument();
  });

  it("asks the consolidated endpoint, scoped to the running outing", async () => {
    // /history, not /history/mine: an admin sees everyone.
    serve([]);
    render(<AdminRecords />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/history?sessionId=s1&limit=100");
    });
  });

  it("reads its filters from the URL", async () => {
    searchParams.value = new URLSearchParams("blockId=b1&interestLevel=high");
    serve([]);
    render(<AdminRecords />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/history?sessionId=s1&limit=100&blockId=b1&interestLevel=high",
      );
    });
  });

  it("writes a chosen filter back to the URL so the view can be sent on", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    expect(replace).toHaveBeenCalledWith("/admin/records?interestLevel=high");
  });

  it("clears back to a bare URL", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("interestLevel=high");
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(replace).toHaveBeenCalledWith("/admin/records");
  });

  it("goes back to a bare URL when the only filter is set back to Any", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("blockId=b1");
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    await user.selectOptions(screen.getByLabelText("Filter by block"), "");
    expect(replace).toHaveBeenCalledWith("/admin/records");
  });

  it("offers no clear button when nothing is filtered", async () => {
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("searches within the page it already has", async () => {
    searchParams.value = new URLSearchParams("q=124");
    serve([entry("#05-123"), entry("#05-124")]);
    render(<AdminRecords />);

    expect(await screen.findByText("#05-124")).toBeInTheDocument();
    expect(screen.queryByText("#05-123")).not.toBeInTheDocument();
  });

  it("distinguishes an empty outing from an over-narrow filter", async () => {
    serve([]);
    const { unmount } = render(<AdminRecords />);
    expect(
      await screen.findByText(/Nothing has been recorded on this outing yet/),
    ).toBeInTheDocument();
    unmount();

    searchParams.value = new URLSearchParams("q=zzz");
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    expect(await screen.findByText("Nothing here matches those filters.")).toBeInTheDocument();
  });

  it("opens the amend sheet on any record, including another member's", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123", { member: "Ben" })]);
    render(<AdminRecords />);

    await user.click(await screen.findByRole("button", { name: /#05-123/ }));
    expect(screen.getByRole("dialog", { name: "Amend #05-123" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("treats no running outing as an ordinary state", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? Promise.reject(new ApiRequestError(404))
        : Promise.resolve(userPage),
    );
    render(<AdminRecords />);

    expect(await screen.findByText("No outing is running.")).toBeInTheDocument();
  });

  it("still lists records when the member picker cannot be loaded", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
      if (path.startsWith("/users")) return Promise.reject(new Error("nope"));
      return Promise.resolve({
        data: [entry("#05-123")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<AdminRecords />);

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
  });

  it("says how much of a long outing is shown", async () => {
    serve([entry("#05-123")], 250);
    render(<AdminRecords />);
    expect(await screen.findByText("Showing the first 1 of 250 records.")).toBeInTheDocument();
  });

  it("offers a retry when the records fail to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<AdminRecords />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");

    serve([entry("#05-123")]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("#05-123")).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AdminRecords />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the records.");
  });

  it("reloads after an amendment, so the list is not stale", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123", { interestLevel: "low" })]);
    render(<AdminRecords />);

    await user.click(await screen.findByRole("button", { name: /#05-123/ }));
    await user.click(screen.getByRole("radio", { name: "High" }));

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
      if (path.startsWith("/users")) return Promise.resolve(userPage);
      if (path.startsWith("/visits/")) return Promise.resolve({});
      return Promise.resolve({
        data: [entry("#05-123", { interestLevel: "high" })],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // Scoped to the row: "High" is also an option in the interest filter.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /#05-123/ })).toHaveTextContent("High");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reloads after recording on someone's behalf", async () => {
    const user = userEvent.setup();
    serve([]);
    render(<AdminRecords />);
    await screen.findByText(/Nothing has been recorded/);

    await user.click(screen.getByRole("button", { name: "Record for a member" }));
    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
      if (path.startsWith("/users")) return Promise.resolve(userPage);
      if (path === "/visits") return Promise.resolve({});
      return Promise.resolve({
        data: [entry("#05-123")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
  });

  it("puts the block and member filters in the URL too", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    await user.selectOptions(screen.getByLabelText("Filter by block"), "b1");
    expect(replace).toHaveBeenCalledWith("/admin/records?blockId=b1");

    await user.selectOptions(screen.getByLabelText("Filter by member"), "u1");
    expect(replace).toHaveBeenCalledWith("/admin/records?memberId=u1");
  });

  it("puts the search term in the URL", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    await user.type(screen.getByLabelText("Search by unit, name or contact"), "t");
    expect(replace).toHaveBeenCalledWith("/admin/records?q=t");
  });

  it("closes the amend sheet without reloading when abandoned", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123")]);
    render(<AdminRecords />);

    await user.click(await screen.findByRole("button", { name: /#05-123/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens and closes the on-behalf form", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    await user.click(screen.getByRole("button", { name: "Record for a member" }));
    expect(
      screen.getByRole("dialog", { name: "Record on behalf of a member" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: "Record on behalf of a member" }),
    ).not.toBeInTheDocument();
  });

  it("names the author, the teammates and the team on each row", async () => {
    serve([
      entry("#05-123", {
        member: "Alice Tan",
        team: {
          id: TEAM_ID,
          name: "Alice & Ben",
          members: [{ id: "u2", name: "Ben Lim", image: null }],
        },
      }),
    ]);
    render(<AdminRecords />);

    const row = await screen.findByRole("button", { name: /#05-123/ });
    expect(row).toHaveTextContent("By Alice Tan with Ben Lim");
    expect(row).toHaveTextContent("Team: Alice & Ben");
  });

  it("offers the running outing's teams as a filter and writes it to the URL", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");

    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    await user.selectOptions(screen.getByLabelText("Filter by team"), TEAM_ID);
    expect(replace).toHaveBeenCalledWith(`/admin/records?teamId=${TEAM_ID}`);
  });

  it("asks the server for one team's records when the URL names it", async () => {
    searchParams.value = new URLSearchParams(`teamId=${TEAM_ID}`);
    serve([]);
    render(<AdminRecords />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(`/history?sessionId=s1&limit=100&teamId=${TEAM_ID}`);
    });
  });

  it("drops a team id an edited URL made up", async () => {
    searchParams.value = new URLSearchParams("teamId=not-a-team");
    serve([]);
    render(<AdminRecords />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/history?sessionId=s1&limit=100");
    });
  });

  it("still lists records when the teams cannot be loaded", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
      if (path.endsWith("/teams")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/users")) return Promise.resolve(userPage);
      return Promise.resolve({
        data: [entry("#05-123")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<AdminRecords />);

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by team").querySelectorAll("option")).toHaveLength(1);
  });

  it.each([
    ["with the other filters kept", "interestLevel=high&", "/admin/records?interestLevel=high"],
    ["back to a bare URL when it was the only filter", "", "/admin/records"],
  ])(
    "drops a team that is not one of this outing's teams from the URL, %s",
    async (_, rest, url) => {
      // A real-looking id from an earlier outing would filter to nothing while
      // the picker said "Any team".
      const other = "0190a1b2-c3d4-7e5f-8a9b-ffffffffffff";
      searchParams.value = new URLSearchParams(`${rest}teamId=${other}`);
      serve([]);
      render(<AdminRecords />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith(url);
      });
    },
  );

  it("keeps a team that is one of this outing's", async () => {
    searchParams.value = new URLSearchParams(`teamId=${TEAM_ID}`);
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");
    expect(screen.getByLabelText("Filter by team")).toHaveValue(TEAM_ID);
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the team while the teams cannot be listed, since nothing is known", async () => {
    const other = "0190a1b2-c3d4-7e5f-8a9b-ffffffffffff";
    searchParams.value = new URLSearchParams(`teamId=${other}`);
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
      if (path.endsWith("/teams")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/users")) return Promise.resolve(userPage);
      return Promise.resolve({
        data: [],
        pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
      });
    });
    render(<AdminRecords />);
    await screen.findByText("Nothing here matches those filters.");
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([`teamId=${TEAM_ID}`, "memberId=u1", "blockId=b1", "interestLevel=low"])(
    "says the filters match nothing, not that nothing was recorded, with %s",
    async (query) => {
      searchParams.value = new URLSearchParams(query);
      serve([]);
      render(<AdminRecords />);
      expect(await screen.findByText("Nothing here matches those filters.")).toBeInTheDocument();
      expect(screen.queryByText(/Nothing has been recorded/)).not.toBeInTheDocument();
    },
  );

  it("shows the household's name and the visit's notes on its row", async () => {
    const visit = entry("#05-123", { name: "Tan" });
    serve([{ ...visit, visit: { ...visit.visit, description: "Asked for Mandarin material" } }]);
    render(<AdminRecords />);

    expect(await screen.findByText("Blk 123 · Tan")).toBeInTheDocument();
    expect(screen.getByText("Asked for Mandarin material")).toBeInTheDocument();
  });

  it("offers a member with no name in the picker by their email", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
      if (path === "/sessions/s1/teams") return Promise.resolve(teamList);
      if (path.startsWith("/users")) {
        return Promise.resolve({
          ...userPage,
          data: userPage.data.map((user) => ({ ...user, name: null })),
        });
      }
      return Promise.resolve({
        data: [entry("#05-123")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<AdminRecords />);

    expect(await screen.findByRole("option", { name: "alice@t.local" })).toHaveValue("u1");
  });

  it("re-reads the records every 30 seconds, so a member's new record turns up", async () => {
    vi.useFakeTimers();
    try {
      serve([entry("#05-123")]);
      render(<AdminRecords />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("#05-123")).toBeInTheDocument();

      serve([entry("#05-123"), entry("#05-124")]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000);
      });
      expect(screen.queryByText("#05-124")).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(screen.getByText("#05-124")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
