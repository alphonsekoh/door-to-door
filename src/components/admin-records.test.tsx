import { render, screen, waitFor } from "@testing-library/react";
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
  options: { member?: string; interestLevel?: InterestLevel; name?: string | null } = {},
): HistoryEntry {
  const { member = "Alice", interestLevel = "low", name = null } = options;
  return {
    visit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId: "s1",
      member: { id: "u1", name: member, image: null },
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

function serve(entries: HistoryEntry[], total = entries.length) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/sessions/active")) return Promise.resolve(activeSession);
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
    expect(screen.getByText(/Ben/)).toBeInTheDocument();
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
    expect(screen.getByRole("form", { name: "Record on behalf of a member" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("form", { name: "Record on behalf of a member" }),
    ).not.toBeInTheDocument();
  });
});
