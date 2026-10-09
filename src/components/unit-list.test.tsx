import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnitList } from "@/components/unit-list";
import type { HouseholdSummary, InterestLevel } from "@/generated/types.gen";

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

type Options = {
  name?: string | null;
  interestLevel?: InterestLevel | null;
  sessionId?: string;
  outstandingFollowUps?: number;
};

function unit(unitNumber: string, options: Options = {}): HouseholdSummary {
  const {
    name = null,
    interestLevel = "low",
    sessionId = "s1",
    outstandingFollowUps = 0,
  } = options;
  return {
    household: {
      id: unitNumber,
      blockId: "b1",
      unitNumber,
      name,
      contact: null,
      religion: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    visitCount: 1,
    latestVisit:
      interestLevel === null
        ? null
        : {
            id: `v-${unitNumber}`,
            householdId: unitNumber,
            sessionId,
            member: { id: "u1", name: "Ben Lim", image: null },
            team: null,
            interestLevel,
            description: "",
            clientCreatedAt: "2026-08-01T00:00:00.000Z",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
    outstandingFollowUps,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  });
});

describe("UnitList", () => {
  it("groups units under their floor, in order", () => {
    render(
      <UnitList
        units={[unit("#12-01"), unit("#05-10"), unit("#05-9")]}
        sessionId="s1"
        onAmended={vi.fn()}
      />,
    );

    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings).toEqual(["Floor 5", "Floor 12"]);

    const floor5 = screen.getByRole("region", { name: "Floor 5" });
    const numbers = within(floor5)
      .getAllByRole("button")
      .map((node) => node.textContent);
    expect(numbers[0]).toContain("#05-9");
    expect(numbers[1]).toContain("#05-10");
  });

  it("reports tonight's progress, not the block's whole history", () => {
    render(
      <UnitList
        units={[
          unit("#05-01", { interestLevel: "high" }),
          unit("#05-02", { interestLevel: "no_response" }),
          unit("#06-01", { sessionId: "older" }),
        ]}
        sessionId="s1"
        onAmended={vi.fn()}
      />,
    );

    expect(screen.getByText("Tonight: 2 units on 1 floor, 1 answered")).toBeInTheDocument();
  });

  it("counts everything when the running session is unknown", () => {
    // The session lookup is allowed to fail; the list must still be useful.
    render(
      <UnitList units={[unit("#05-01"), unit("#06-01")]} sessionId={null} onAmended={vi.fn()} />,
    );
    expect(screen.getByText("On this block: 2 units on 2 floors, 2 answered")).toBeInTheDocument();
  });

  it("marks the units recorded during the running outing", () => {
    render(
      <UnitList
        units={[unit("#05-01"), unit("#05-02", { sessionId: "older" })]}
        sessionId="s1"
        onAmended={vi.fn()}
      />,
    );
    expect(screen.getAllByText("tonight")).toHaveLength(1);
  });

  it("shows the interest level in words", () => {
    render(
      <UnitList
        units={[unit("#05-01", { interestLevel: "high" })]}
        sessionId="s1"
        onAmended={vi.fn()}
      />,
    );
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("shows a household with no visit without a chip", () => {
    render(
      <UnitList
        units={[unit("#05-01", { interestLevel: null })]}
        sessionId="s1"
        onAmended={vi.fn()}
      />,
    );
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });

  it("surfaces outstanding follow-ups on the row", () => {
    render(
      <UnitList
        units={[
          unit("#05-01", { outstandingFollowUps: 1 }),
          unit("#05-02", { outstandingFollowUps: 3 }),
        ]}
        sessionId="s1"
        onAmended={vi.fn()}
      />,
    );
    expect(screen.getByText("1 follow-up outstanding")).toBeInTheDocument();
    expect(screen.getByText("3 follow-ups outstanding")).toBeInTheDocument();
  });

  it("filters by unit number, name or contact", async () => {
    const user = userEvent.setup();
    render(
      <UnitList
        units={[unit("#05-01", { name: "Mr Tan" }), unit("#06-02", { name: "Ms Lim" })]}
        sessionId="s1"
        onAmended={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search this block"), "lim");
    expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
    expect(screen.getByText("Ms Lim")).toBeInTheDocument();
  });

  it("says when a search matches nothing", async () => {
    const user = userEvent.setup();
    render(<UnitList units={[unit("#05-01")]} sessionId="s1" onAmended={vi.fn()} />);

    await user.type(screen.getByLabelText("Search this block"), "zzz");
    expect(screen.getByText('Nothing here matches "zzz".')).toBeInTheDocument();
  });

  it("says when the block has nothing on it yet", () => {
    render(<UnitList units={[]} sessionId="s1" onAmended={vi.fn()} />);
    expect(screen.getByText("No units recorded here yet.")).toBeInTheDocument();
  });

  it("opens the amend sheet for the unit that was tapped", async () => {
    const user = userEvent.setup();
    render(
      <UnitList units={[unit("#05-01"), unit("#05-02")]} sessionId="s1" onAmended={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /#05-02/ }));
    expect(screen.getByRole("dialog", { name: "Amend #05-02" })).toBeInTheDocument();
  });

  it("closes the sheet without reloading when the amendment is abandoned", async () => {
    const user = userEvent.setup();
    const onAmended = vi.fn();
    render(<UnitList units={[unit("#05-01")]} sessionId="s1" onAmended={onAmended} />);

    await user.click(screen.getByRole("button", { name: /#05-01/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onAmended).not.toHaveBeenCalled();
  });
});
