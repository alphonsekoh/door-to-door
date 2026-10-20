import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRecords } from "@/components/session-records";
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
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  }),
}));

const AT = "2026-03-14T11:00:00.000Z";

function entry(
  unitNumber: string,
  options: {
    blockId?: string;
    blockName?: string;
    interestLevel?: InterestLevel;
    name?: string | null;
    description?: string;
    author?: { id: string; name: string | null };
    team?: HistoryEntry["visit"]["team"];
    status?: "active" | "ended";
  } = {},
): HistoryEntry {
  const {
    blockId = "b1",
    blockName = "123",
    interestLevel = "low",
    name = null,
    description = "",
    author = { id: "u1", name: "Alice" },
    team = null,
    status = "ended",
  } = options;
  return {
    visit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId: "s1",
      member: { ...author, image: null },
      team,
      interestLevel,
      description,
      clientCreatedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
    household: {
      id: `h-${unitNumber}`,
      blockId,
      unitNumber,
      name,
      contact: null,
      religion: null,
      createdAt: AT,
      updatedAt: AT,
    },
    block: { id: blockId, name: blockName, street: "Test Ave", postalCode: null, createdAt: AT },
    session: {
      id: "s1",
      title: "March outing",
      status,
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: AT,
    },
  };
}

const page = (rows: HistoryEntry[], total = rows.length) => ({
  data: rows,
  pagination: { limit: 50, offset: 0, total, hasMore: rows.length < total },
});

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
});

describe("SessionRecords", () => {
  it("lists the member's records for the outing", async () => {
    apiFetch.mockResolvedValue(page([entry("#05-123"), entry("#05-124")]));
    render(<SessionRecords sessionId="s1" />);

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    expect(screen.getByText("#05-124")).toBeInTheDocument();
  });

  it("asks the own-records endpoint, scoped to the outing", async () => {
    // Never /history: that one is admin-only and would widen the view.
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/history/mine?limit=50&offset=0&sessionId=s1");
    });
  });

  it("links each record to the unit's full timeline", async () => {
    apiFetch.mockResolvedValue(page([entry("#05-123")]));
    render(<SessionRecords sessionId="s1" />);

    expect(await screen.findByRole("link", { name: /#05-123/ })).toHaveAttribute(
      "href",
      "/households/h-#05-123",
    );
  });

  it("shows the block, the name and the note when there are any", async () => {
    apiFetch.mockResolvedValue(
      page([entry("#05-123", { name: "Mr Tan", description: "Come back Sunday" })]),
    );
    render(<SessionRecords sessionId="s1" />);

    expect(await screen.findByText("Blk 123 · Mr Tan")).toBeInTheDocument();
    expect(screen.getByText("Come back Sunday")).toBeInTheDocument();
  });

  it("shows the interest level in words on the row", async () => {
    apiFetch.mockResolvedValue(page([entry("#05-123", { interestLevel: "high" })]));
    render(<SessionRecords sessionId="s1" />);
    // Scoped to the row: "High" is also an option in the interest filter.
    const row = await screen.findByRole("link", { name: /#05-123/ });
    expect(row).toHaveTextContent("High");
  });

  it("offers only the blocks the member actually worked", async () => {
    apiFetch.mockResolvedValue(
      page([
        entry("#05-123", { blockId: "b2", blockName: "125" }),
        entry("#03-01", { blockId: "b1", blockName: "123" }),
      ]),
    );
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");

    const options = [...screen.getByLabelText("Filter by block").querySelectorAll("option")];
    expect(options.map((option) => option.textContent)).toEqual([
      "All blocks",
      "Blk 123",
      "Blk 125",
    ]);
  });

  it("refetches when a block filter is chosen", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([entry("#05-123")]));
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");

    await user.selectOptions(screen.getByLabelText("Filter by block"), "b1");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/history/mine?limit=50&offset=0&sessionId=s1&blockId=b1",
      );
    });
  });

  it("refetches when an interest level is chosen", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([entry("#05-123")]));
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");

    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/history/mine?limit=50&offset=0&sessionId=s1&interestLevel=high",
      );
    });
  });

  it("keeps the block picker whole while a filter is applied", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(
      page([
        entry("#05-123", { blockId: "b2", blockName: "125" }),
        entry("#03-01", { blockId: "b1", blockName: "123" }),
      ]),
    );
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");

    // A filtered response must not narrow the picker to its own results.
    apiFetch.mockResolvedValue(page([entry("#03-01", { blockId: "b1", blockName: "123" })]));
    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");

    await waitFor(() => {
      expect([...screen.getByLabelText("Filter by block").querySelectorAll("option")]).toHaveLength(
        3,
      );
    });
  });

  it("says there is nothing of the member's on this outing when nothing is filtered", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);
    expect(await screen.findByText("You recorded nothing on this session.")).toBeInTheDocument();
    expect(screen.queryByText(/matches those filters/)).not.toBeInTheDocument();
  });

  it("says nothing of the team's either in the team view", async () => {
    searchParams.value = new URLSearchParams("view=team");
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);
    expect(
      await screen.findByText("Neither you nor your team recorded anything on this session."),
    ).toBeInTheDocument();
  });

  it("says when the filters match nothing", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(page([entry("#05-123")]));
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");

    apiFetch.mockResolvedValue(page([]));
    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    expect(await screen.findByText("Nothing here matches those filters.")).toBeInTheDocument();
  });

  it("says how much of a long outing is shown", async () => {
    apiFetch.mockResolvedValue(page([entry("#05-123")], 120));
    render(<SessionRecords sessionId="s1" />);
    expect(await screen.findByText("Showing the first 1 of 120 records.")).toBeInTheDocument();
  });

  it("reports a failure instead of an empty outing", async () => {
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<SessionRecords sessionId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<SessionRecords sessionId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load these records.");
  });
});

const BEN = { id: "u2", name: "Ben Lim" };
const PAIR = { id: "t1", name: "Alice & Ben", members: [{ id: "u1", name: "Alice", image: null }] };

describe("Me or My team", () => {
  it("starts on Me and asks for own records only", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);
    expect(await screen.findByRole("button", { name: "Me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("includeTeam"));
  });

  it("asks for team records when the URL says so, and says what that adds", async () => {
    searchParams.value = new URLSearchParams("view=team");
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/history/mine?limit=50&offset=0&includeTeam=true&sessionId=s1",
      );
    });
    expect(screen.getByRole("button", { name: "My team" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText(/teams you are on now/)).toBeInTheDocument();
    expect(screen.getByText(/waiting on a teammate's phone/)).toBeInTheDocument();
  });

  it("reads anything but the known value as Me", async () => {
    searchParams.value = new URLSearchParams("view=everyone");
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("You recorded nothing on this session.");
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("includeTeam"));
  });

  it("writes the choice to the URL so it survives navigation", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);

    await user.click(await screen.findByRole("button", { name: "My team" }));
    expect(replace).toHaveBeenCalledWith("/history/s1?view=team");
    await user.click(screen.getByRole("button", { name: "Me" }));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("goes back to Me from the team view", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Me" }));
    expect(replace).toHaveBeenCalledWith("/history/s1");
  });

  it("names the author and teammates on a teammate's row and lets it be amended", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    apiFetch.mockResolvedValue(
      page([entry("#05-123", { author: BEN, team: PAIR, status: "active" })]),
    );
    render(<SessionRecords sessionId="s1" />);

    expect(await screen.findByText("By Ben Lim with Alice")).toBeInTheDocument();
    expect(screen.getByText("Team: Alice & Ben")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Amend #05-123" }));
    const sheet = screen.getByRole("dialog", { name: "Amend #05-123" });
    expect(within(sheet).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("reloads after an amendment is saved", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([entry("#05-123", { status: "active" })]));
    render(<SessionRecords sessionId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Amend #05-123" }));
    await user.click(screen.getByRole("radio", { name: "High" }));
    const before = apiFetch.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(apiFetch.mock.calls.length).toBeGreaterThan(before + 1);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not offer Amend on an outing that has ended", async () => {
    apiFetch.mockResolvedValue(page([entry("#05-123")]));
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");
    expect(screen.queryByRole("button", { name: /Amend/ })).not.toBeInTheDocument();
  });

  it("closes the amend sheet without reloading when cancelled", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([entry("#05-123", { status: "active" })]));
    render(<SessionRecords sessionId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Amend #05-123" }));
    const calls = apiFetch.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiFetch.mock.calls.length).toBe(calls);
  });

  it("drops an answer that arrives after a newer request", async () => {
    const user = userEvent.setup();
    const slow: { resolve: (value: unknown) => void } = { resolve: () => undefined };
    apiFetch.mockResolvedValueOnce(page([entry("#05-123")]));
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");

    apiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          slow.resolve = resolve;
        }),
    );
    apiFetch.mockResolvedValueOnce(page([entry("#09-999")]));
    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "low");
    expect(await screen.findByText("#09-999")).toBeInTheDocument();

    await act(async () => {
      slow.resolve(page([entry("#01-001")]));
      await Promise.resolve();
    });
    expect(screen.queryByText("#01-001")).not.toBeInTheDocument();
    expect(screen.getByText("#09-999")).toBeInTheDocument();
  });

  it("drops a failure that arrives after a newer request", async () => {
    const user = userEvent.setup();
    const slow: { reject: (error: unknown) => void } = { reject: () => undefined };
    apiFetch.mockResolvedValueOnce(page([entry("#05-123")]));
    render(<SessionRecords sessionId="s1" />);
    await screen.findByText("#05-123");

    apiFetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          slow.reject = reject;
        }),
    );
    apiFetch.mockResolvedValueOnce(page([entry("#09-999")]));
    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "low");
    expect(await screen.findByText("#09-999")).toBeInTheDocument();

    await act(async () => {
      slow.reject(new Error("late"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
