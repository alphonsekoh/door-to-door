import { render, screen, waitFor } from "@testing-library/react";
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

const AT = "2026-03-14T11:00:00.000Z";

function entry(
  unitNumber: string,
  options: {
    blockId?: string;
    blockName?: string;
    interestLevel?: InterestLevel;
    name?: string | null;
    description?: string;
  } = {},
): HistoryEntry {
  const {
    blockId = "b1",
    blockName = "123",
    interestLevel = "low",
    name = null,
    description = "",
  } = options;
  return {
    visit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId: "s1",
      member: { id: "u1", name: "Alice", image: null },
      team: null,
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
      status: "ended",
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
      expect(apiFetch).toHaveBeenCalledWith("/history/mine?sessionId=s1&limit=50");
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
      expect(apiFetch).toHaveBeenCalledWith("/history/mine?sessionId=s1&limit=50&blockId=b1");
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
        "/history/mine?sessionId=s1&limit=50&interestLevel=high",
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

  it("says when the filters match nothing", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<SessionRecords sessionId="s1" />);
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
