import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdScreen } from "@/components/households/household-screen";
import type { HouseholdHistory } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

const AT = "2026-03-14T11:00:00.000Z";

const history: HouseholdHistory = {
  household: {
    id: "h1",
    blockId: "b1",
    unitNumber: "#05-123",
    name: "Mr Tan",
    contact: "91234567",
    religion: null,
    createdAt: AT,
    updatedAt: AT,
  },
  block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
  visits: [
    {
      id: "v1",
      householdId: "h1",
      sessionId: "s1",
      member: { id: "u2", name: "Ben Lim", image: null },
      team: null,
      interestLevel: "medium",
      description: "Asked us to come back",
      clientCreatedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  followUps: [],
};

const owed = {
  id: "f1",
  householdId: "h1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  author: { id: "u1", name: "Alice", image: null },
  note: "Bring the flyer.",
  dueDate: null,
  doneAt: null,
  doneBy: null,
  createdAt: AT,
};

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  useOnline.mockReturnValue(true);
});

/* Answers GETs with the unit and everything else with an empty success. */
const serve = (unit: (call: number) => HouseholdHistory | Promise<HouseholdHistory>) => {
  let reads = 0;
  apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
    init?.method === undefined ? Promise.resolve(unit(++reads)) : Promise.resolve({}),
  );
};

describe("HouseholdScreen", () => {
  it("names the unit and its block", async () => {
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    // The unit is the page's heading, so the outline has somewhere to land.
    expect(await screen.findByRole("heading", { level: 1, name: "#05-123" })).toBeInTheDocument();
    expect(screen.getByText("Blk 123, Test Ave")).toBeInTheDocument();
  });

  it("offers a way back in every state, so a failed load is no trap", async () => {
    apiFetch.mockRejectedValue(new Error("Could not load this unit."));
    render(<HouseholdScreen householdId="h1" />);
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/follow-ups");
  });

  it("shows what every member learned, not only the caller's own visit", async () => {
    // A door's history is shared; that is the point of the household split.
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText("Asked us to come back")).toBeInTheDocument();
    expect(screen.getAllByText(/Ben Lim/).length).toBeGreaterThan(0);
  });

  it("says in the header who made the latest visit, and with whom", async () => {
    const earlier = history.visits[0];
    if (earlier === undefined) throw new Error("fixture has a visit");
    apiFetch.mockResolvedValue({
      ...history,
      visits: [
        earlier,
        {
          ...earlier,
          id: "v2",
          member: { id: "u1", name: "Alice Tan", image: null },
          team: {
            id: "t1",
            name: "Alice & Ben",
            members: [{ id: "u2", name: "Ben Lim", image: null }],
          },
        },
      ],
    });
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText("Last visit by Alice Tan with Ben Lim")).toBeInTheDocument();
  });

  it("has no last-visit line for a unit nobody has visited", async () => {
    apiFetch.mockResolvedValue({ ...history, visits: [] });
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    expect(screen.queryByText(/Last visit by/)).not.toBeInTheDocument();
  });

  it("asks for the unit it was given", async () => {
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/households/h1");
    });
  });

  it("reports a failure rather than an empty unit", async () => {
    apiFetch.mockRejectedValue(new Error("No such unit."));
    render(<HouseholdScreen householdId="h1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No such unit.");
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<HouseholdScreen householdId="h1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this unit.");
  });

  it("adds a note to the unit from the header, not tied to a visit", async () => {
    serve(() => history);
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add follow-up" }));
    const sheet = within(screen.getByRole("dialog", { name: "Follow-up for #05-123" }));
    fireEvent.change(sheet.getByLabelText("Note"), { target: { value: "Call back" } });
    fireEvent.click(sheet.getByRole("button", { name: "Save follow-up" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
        method: "POST",
        body: JSON.stringify({
          householdId: "h1",
          visitId: null,
          note: "Call back",
          dueDate: null,
        }),
      });
    });
    await waitFor(() => {
      expect(apiFetch.mock.calls.filter(([path]) => path === "/households/h1")).toHaveLength(2);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the add sheet on Cancel", async () => {
    serve(() => history);
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add follow-up" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("offers a follow-up on each visit row", async () => {
    serve(() => history);
    render(<HouseholdScreen householdId="h1" />);
    expect(
      await screen.findByRole("button", { name: "Follow up on this visit" }),
    ).toBeInTheDocument();
  });

  it("re-reads the unit after a note is marked done", async () => {
    serve((call) =>
      call === 1
        ? { ...history, followUps: [owed] }
        : {
            ...history,
            followUps: [
              { ...owed, doneAt: AT, doneBy: { id: "u2", name: "Ben Lim", image: null } },
            ],
          },
    );
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    expect(await screen.findByText(/Done by Ben Lim/)).toBeInTheDocument();
  });

  it("keeps the unit on screen when a re-read fails", async () => {
    serve((call) =>
      call === 1 ? { ...history, followUps: [owed] } : Promise.reject(new TypeError("offline")),
    );
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText("#05-123")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets only the newest of two re-reads land", async () => {
    let releaseFirst: (value: HouseholdHistory) => void = () => undefined;
    serve((call) => {
      if (call === 1) return { ...history, followUps: [owed] };
      if (call === 2) {
        return new Promise<HouseholdHistory>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { ...history, followUps: [], visits: [] };
    });
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(3);
    });
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => {
      expect(screen.queryByText("Asked us to come back")).not.toBeInTheDocument();
    });
    releaseFirst({ ...history, followUps: [owed] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Asked us to come back")).not.toBeInTheDocument();
  });
});
