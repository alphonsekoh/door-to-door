import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdScreen } from "@/components/household-screen";
import type { HouseholdHistory } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HouseholdScreen", () => {
  it("names the unit and its block", async () => {
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    expect(screen.getByText("Blk 123, Test Ave")).toBeInTheDocument();
  });

  it("shows what every member learned, not only the caller's own visit", async () => {
    // A door's history is shared; that is the point of the household split.
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText(/Ben Lim/)).toBeInTheDocument();
    expect(screen.getByText("Asked us to come back")).toBeInTheDocument();
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
});
