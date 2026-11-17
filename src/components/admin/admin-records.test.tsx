import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRecords } from "@/components/admin/admin-records";
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

vi.mock("@/lib/hooks/use-role", () => ({
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
      kind: "regular",
      status: "active",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: AT,
    },
  };
}

/* The answer to recording on a member's behalf. */
function recorded(id: string, marked: string[], name: string | null = "Alice") {
  return {
    ...entry("#05-123").visit,
    id,
    member: { id: "u1", name, image: null },
    followUpsMarkedDone: marked,
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
  window.history.replaceState(null, "", "/");
});

/* An old link, in the address and so in what useSearchParams reads. */
function openAt(url: string) {
  window.history.replaceState(null, "", url);
  searchParams.value = new URL(url, window.location.href).searchParams;
}

const address = () => `${window.location.pathname}${window.location.search}`;

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

  it("searches within the page it already has, with nothing in the URL and nothing asked of the server", async () => {
    // The term is a name or a phone number: a query string would carry it to
    // the server's logs, the phone's history and a sign-in's callbackUrl (#130).
    const user = userEvent.setup();
    serve([entry("#05-123"), entry("#05-124")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");
    apiFetch.mockClear();

    await user.type(screen.getByLabelText("Search by unit, name or contact"), "124");

    expect(screen.getByText("#05-124")).toBeInTheDocument();
    expect(screen.queryByText("#05-123")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    // Let any deferred load run: typing must not start one.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("moves an old link's search term from the address into the search (#163)", async () => {
    // Left in the address, it would ride into a sign-in's callbackUrl.
    openAt("/admin/records?q=124&interestLevel=low");
    serve([entry("#05-123"), entry("#05-124")]);
    render(<AdminRecords />);

    expect(await screen.findByText("#05-124")).toBeInTheDocument();
    expect(screen.queryByText("#05-123")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search by unit, name or contact")).toHaveValue("124");
    expect(address()).toBe("/admin/records?interestLevel=low");
    // The router's replace waits on the server, and reloads the page, search
    // emptied, if that fails.
    expect(replace).not.toHaveBeenCalled();
    const asked = apiFetch.mock.calls.map(([path]) => String(path));
    expect(asked.filter((path) => /q=|124/.test(path))).toEqual([]);
  });

  it("goes back to the bare screen when the search term was all the link held", async () => {
    openAt("/admin/records?q=124");
    serve([entry("#05-123"), entry("#05-124")]);
    render(<AdminRecords />);

    expect(await screen.findByText("#05-124")).toBeInTheDocument();
    expect(address()).toBe("/admin/records");
  });

  it("clears the search along with the filters", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("interestLevel=low");
    serve([entry("#05-123"), entry("#05-124")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");
    const search = screen.getByLabelText("Search by unit, name or contact");
    await user.type(search, "124");
    expect(screen.queryByText("#05-123")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(replace).toHaveBeenCalledWith("/admin/records");
    expect(search).toHaveValue("");
    expect(screen.getByText("#05-123")).toBeInTheDocument();
  });

  it("distinguishes an empty outing from an over-narrow filter", async () => {
    const user = userEvent.setup();
    serve([]);
    const { unmount } = render(<AdminRecords />);
    expect(
      await screen.findByText(/Nothing has been recorded in this session yet/),
    ).toBeInTheDocument();
    unmount();

    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");
    await user.type(screen.getByLabelText("Search by unit, name or contact"), "zzz");
    expect(screen.getByText("Nothing here matches those filters.")).toBeInTheDocument();
    // A search alone can be cleared.
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("#05-123")).toBeInTheDocument();
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

    expect(await screen.findByText("No session is running.")).toBeInTheDocument();
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
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AdminRecords />);

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the records.");

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
      if (path === "/visits") return Promise.resolve(recorded("v1", []));
      return Promise.resolve({
        data: [entry("#05-123")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    // A record that marked nothing says nothing more: door-to-door as before.
    expect(screen.queryByRole("status")).toBeNull();
  });

  describe("a record that marked follow-ups done (follow-up session)", () => {
    const UNDO = "Undo marking the follow-up done";

    /* The server answers each record in turn; a reopen answers as `reopen` says. */
    function serveRecords(
      answers: ReturnType<typeof recorded>[],
      reopen: () => Promise<unknown> = () => Promise.resolve({}),
    ) {
      const queue = [...answers];
      apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
        if (path === "/visits") return Promise.resolve(queue.shift());
        if (init?.method === "PATCH") return reopen();
        if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
        if (path.startsWith("/users")) return Promise.resolve(userPage);
        return Promise.resolve({
          data: [],
          pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
        });
      });
    }

    async function recordFor(user: ReturnType<typeof userEvent.setup>, unit: string) {
      await user.click(screen.getByRole("button", { name: "Record for a member" }));
      await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
      await user.type(screen.getByLabelText("Unit number"), unit);
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save the record" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    }

    const patches = () =>
      apiFetch.mock.calls.filter(
        ([, init]) => (init as { method?: string } | undefined)?.method === "PATCH",
      );

    it("says so, naming the member credited, and Undo reopens exactly that", async () => {
      const user = userEvent.setup();
      serveRecords([recorded("v1", ["n1"])]);
      render(<AdminRecords />);
      await screen.findByText(/Nothing has been recorded/);

      await recordFor(user, "#05-123");
      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent("Saved #05-123 for Alice. Follow-up marked done.");

      await user.click(within(status).getByRole("button", { name: UNDO }));
      expect(status).toHaveTextContent("Saved #05-123 for Alice. Undone. Follow-up reopened.");
      expect(within(status).queryByRole("button", { name: /^Undo/ })).toBeNull();
      expect(patches()).toEqual([
        [
          "/follow-ups/n1",
          { method: "PATCH", body: JSON.stringify({ done: false, markedByVisit: "v1" }) },
        ],
      ]);
      // The record itself is never touched again.
      expect(apiFetch.mock.calls.filter(([path]) => path === "/visits")).toHaveLength(1);
    });

    it("cannot undo without signal", async () => {
      /* The browser losing and finding its signal, as useOnline hears it. */
      const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
      const setOnLine = (value: boolean) => {
        onLine.mockReturnValue(value);
        window.dispatchEvent(new Event(value ? "online" : "offline"));
      };
      const user = userEvent.setup();
      serveRecords([recorded("v1", ["n1"])]);
      render(<AdminRecords />);
      await screen.findByText(/Nothing has been recorded/);
      await recordFor(user, "#05-123");
      const undo = within(await screen.findByRole("status")).getByRole("button", { name: UNDO });
      expect(undo).toBeEnabled();

      act(() => {
        setOnLine(false);
      });
      expect(undo).toBeDisabled();
      act(() => {
        setOnLine(true);
      });
      expect(undo).toBeEnabled();
      onLine.mockRestore();
    });

    it("keeps Undo after no answer, and a second try finishes it", async () => {
      const user = userEvent.setup();
      let attempts = 0;
      serveRecords([recorded("v1", ["n1", "n2"])], () => {
        attempts += 1;
        return attempts === 2
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve({});
      });
      render(<AdminRecords />);
      await screen.findByText(/Nothing has been recorded/);

      await recordFor(user, "#05-123");
      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent("2 follow-ups marked done.");
      await user.click(
        within(status).getByRole("button", { name: "Undo marking the follow-ups done" }),
      );
      expect(status).toHaveTextContent("Not undone. Check your signal and try again.");

      // Only what is left is sent again, and both count as reopened.
      await user.click(within(status).getByRole("button", { name: UNDO }));
      expect(status).toHaveTextContent("Undone. 2 follow-ups reopened.");
      expect(patches().map(([path]) => String(path))).toEqual([
        "/follow-ups/n1",
        "/follow-ups/n2",
        "/follow-ups/n2",
      ]);
    });

    it("moves on to the next record, and drops a late answer for the last", async () => {
      const user = userEvent.setup();
      const answers: ((value: unknown) => void)[] = [];
      serveRecords(
        [recorded("v1", ["n1"]), recorded("v2", ["n2"], null), recorded("v3", [])],
        () => new Promise((resolve) => answers.push(resolve)),
      );
      render(<AdminRecords />);
      await screen.findByText(/Nothing has been recorded/);

      await recordFor(user, "#05-123");
      await user.click(
        within(await screen.findByRole("status")).getByRole("button", { name: UNDO }),
      );
      expect(screen.getByRole("button", { name: "Undoing…" })).toBeDisabled();

      // A member with no name is not named.
      await recordFor(user, "#05-124");
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(/^Saved #05-124\. Follow-up marked done\./);
      // Its Undo is not held up by the first, still on its way.
      await user.click(within(status).getByRole("button", { name: UNDO }));
      expect(patches().map(([path]) => String(path))).toEqual(["/follow-ups/n1", "/follow-ups/n2"]);
      expect(within(status).getByRole("button", { name: "Undoing…" })).toBeDisabled();
      await act(async () => {
        answers[0]?.({});
        await Promise.resolve();
      });
      expect(status).toHaveTextContent("Undoing…");
      expect(status).not.toHaveTextContent(/Undone/);
      await act(async () => {
        answers[1]?.({});
        await Promise.resolve();
      });
      expect(status).toHaveTextContent(/^Saved #05-124\. Undone\. Follow-up reopened\.$/);

      // A record that marked nothing clears the line.
      await recordFor(user, "#05-125");
      expect(screen.queryByRole("status")).toBeNull();
    });
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

  it("keeps the search term out of the URL when another filter is chosen", async () => {
    const user = userEvent.setup();
    serve([entry("#05-123")]);
    render(<AdminRecords />);
    await screen.findByText("#05-123");
    const search = screen.getByLabelText("Search by unit, name or contact");
    await user.type(search, "123");

    await user.selectOptions(screen.getByLabelText("Filter by block"), "b1");

    expect(replace).toHaveBeenLastCalledWith("/admin/records?blockId=b1");
    expect(search).toHaveValue("123");
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
