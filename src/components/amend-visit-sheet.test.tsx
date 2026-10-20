import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmendVisitSheet } from "@/components/amend-visit-sheet";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import type { HouseholdSummary, InterestLevel } from "@/generated/types.gen";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

type Options = {
  name?: string | null;
  contact?: string | null;
  interestLevel?: InterestLevel;
  memberId?: string;
  visit?: boolean;
};

function entryFor(options: Options = {}): HouseholdSummary {
  const {
    name = null,
    contact = null,
    interestLevel = "low",
    memberId = "u1",
    visit = true,
  } = options;
  return {
    household: {
      id: "h1",
      blockId: "b1",
      unitNumber: "#05-123",
      name,
      contact,
      religion: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    visitCount: 1,
    latestVisit: visit
      ? {
          id: "v1",
          householdId: "h1",
          sessionId: "s1",
          member: { id: memberId, name: "Ben Lim", image: null },
          team: null,
          interestLevel,
          description: "Asked us to come back",
          clientCreatedAt: "2026-08-01T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }
      : null,
    outstandingFollowUps: 0,
  };
}

/* Ben's record, stamped with a team whose snapshot names the viewer u1. */
function teamEntry(): HouseholdSummary {
  const entry = entryFor({ memberId: "u9" });
  if (entry.latestVisit === null) throw new Error("fixture has a visit");
  return {
    ...entry,
    latestVisit: {
      ...entry.latestVisit,
      team: { id: "t1", name: "Ben & Ann", members: [{ id: "u1", name: "Ann Tan", image: null }] },
    },
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

describe("AmendVisitSheet", () => {
  it("is a modal: focus moves in, Tab stays in, Escape closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AmendVisitSheet entry={entryFor()} onClose={onClose} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Amend #05-123" });
    expect(dialog).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("pre-fills every field from what was recorded", async () => {
    render(
      <AmendVisitSheet
        entry={entryFor({ name: "Mr Tan", contact: "91234567" })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: "Low" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Notes")).toHaveValue("Asked us to come back");

    await userEvent.setup().click(screen.getByRole("button", { name: "Add details" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Mr Tan");
    expect(screen.getByLabelText("Contact")).toHaveValue("91234567");
  });

  it("sends only the field that changed", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    apiFetch.mockResolvedValue({});

    render(<AmendVisitSheet entry={entryFor()} onClose={vi.fn()} onSaved={onSaved} />);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/visits/v1", {
      method: "PATCH",
      body: JSON.stringify({ interestLevel: "high" }),
    });
  });

  it("sends the identity fields a member fills in", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({});

    render(<AmendVisitSheet entry={entryFor()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.type(screen.getByLabelText("Name"), "Mr Tan");
    await user.selectOptions(screen.getByLabelText("Religion"), "buddhist");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/visits/v1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Mr Tan", religion: "buddhist" }),
      });
    });
  });

  it("sends a corrected contact and note", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({});

    render(<AmendVisitSheet entry={entryFor()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.type(screen.getByLabelText("Contact"), "91234567");
    await user.clear(screen.getByLabelText("Notes"));
    await user.type(screen.getByLabelText("Notes"), "Wrong flat");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/visits/v1", {
        method: "PATCH",
        body: JSON.stringify({ description: "Wrong flat", contact: "91234567" }),
      });
    });
  });

  it("closes without a request when nothing was touched", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<AmendVisitSheet entry={entryFor()} onClose={onClose} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The contract rejects an empty patch, and an untouched save would still
    // bump updatedAt and beat a real edit arriving from a queued device.
    expect(apiFetch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("will not let a member amend someone else's record", () => {
    render(
      <AmendVisitSheet entry={entryFor({ memberId: "u9" })} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    expect(screen.getByText(/Recorded by Ben Lim/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("names an unnamed member as Someone", () => {
    const entry = entryFor({ memberId: "u9" });
    if (entry.latestVisit) entry.latestVisit.member.name = null;

    render(<AmendVisitSheet entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Recorded by Someone")).toBeInTheDocument();
  });

  it("lets a current teammate amend, showing whose record it is", () => {
    render(
      <AmendVisitSheet entry={teamEntry()} teamIds={["t1"]} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByText("Recorded by Ben Lim with Ann Tan")).toBeInTheDocument();
    expect(screen.getByText("Team: Ben & Ann")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("does not take being named on the record as the right to edit it", () => {
    // The snapshot names u1, but the server has not said u1 is on the team now.
    render(<AmendVisitSheet entry={teamEntry()} onClose={vi.fn()} onSaved={vi.fn()} />);
    // Read-only, it still names everyone the row names.
    expect(screen.getByText("Recorded by Ben Lim with Ann Tan")).toBeInTheDocument();
    expect(screen.getByText("Team: Ben & Ann")).toBeInTheDocument();
    expect(screen.getByText(/Only they, their current teammates or an admin/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("explains a refusal after the teammate was taken off the team", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "server words" } }),
    );
    render(
      <AmendVisitSheet entry={teamEntry()} teamIds={["t1"]} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not on this record's team any more/);
    expect(alert).not.toHaveTextContent("server words");
  });

  it("does not blame the team when an admin's right was the one refused", async () => {
    const user = userEvent.setup();
    useRole.mockReturnValue({
      userId: "admin1",
      role: "admin",
      isAdmin: true,
      isMember: false,
      isLoading: false,
      isSignedIn: true,
    });
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "server words" } }),
    );
    render(<AmendVisitSheet entry={teamEntry()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can no longer amend this record.",
    );
  });

  it("sends one request for a double tap on Save", async () => {
    let finish: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onSaved = vi.fn();
    render(<AmendVisitSheet entry={entryFor()} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    const save = screen.getByRole("button", { name: "Save changes" });
    /* Both taps land before React re-renders, so the disabled button cannot
       stop the second one: only the synchronous guard can. */
    act(() => {
      save.click();
      save.click();
    });
    finish(undefined);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("lets an admin amend anyone's record", () => {
    useRole.mockReturnValue({
      userId: "admin1",
      role: "admin",
      isAdmin: true,
      isMember: false,
      isLoading: false,
      isSignedIn: true,
    });

    render(
      <AmendVisitSheet entry={entryFor({ memberId: "u9" })} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("says so when there is nothing recorded to amend", () => {
    render(
      <AmendVisitSheet entry={entryFor({ visit: false })} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByText(/Nothing has been recorded here yet/)).toBeInTheDocument();
  });

  it("keeps the sheet open and reports a rejected amendment", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    apiFetch.mockRejectedValue(new Error("That session has ended."));

    render(<AmendVisitSheet entry={entryFor()} onClose={vi.fn()} onSaved={onSaved} />);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That session has ended.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("copes with a non-Error failure", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue("boom");

    render(<AmendVisitSheet entry={entryFor()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save this change.");
  });

  it("closes from the backdrop and from Cancel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<AmendVisitSheet entry={entryFor()} onClose={onClose} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("asks before a stray tap on the backdrop loses a correction", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AmendVisitSheet entry={entryFor()} onClose={onClose} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    const ask = screen.getByRole("alertdialog", { name: "Discard your changes?" });
    expect(ask).toHaveTextContent("The visit stays as it was recorded.");
    await user.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "true");

    // Put back as it was, there is nothing left to lose.
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("hides the details again on a second tap", async () => {
    const user = userEvent.setup();
    render(<AmendVisitSheet entry={entryFor()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
});
