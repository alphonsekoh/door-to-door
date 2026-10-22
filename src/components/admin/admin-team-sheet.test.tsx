import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminTeamSheet } from "@/components/admin/admin-team-sheet";

const people = [
  { id: "admin", name: "Ada Admin" },
  { id: "cy", name: "Cy Ong" },
  { id: "dee", name: null },
];

function sheet(overrides: Partial<Parameters<typeof AdminTeamSheet>[0]> = {}) {
  const props = {
    mode: "create" as const,
    initialName: "",
    candidates: people,
    meId: "admin",
    canChange: true,
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<AdminTeamSheet {...props} />);
  return props;
}

describe("AdminTeamSheet", () => {
  it("puts the name field above the people, and the action in a sticky footer", () => {
    sheet();
    const name = screen.getByLabelText(/Team name/);
    const list = screen.getByRole("list", { name: "People" });
    expect(name.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The scrolling body keeps a focused field clear of the sticky footer.
    expect(
      screen.getByRole("dialog", { name: "New team" }).querySelector(".overflow-y-auto")?.className,
    ).toContain("scroll-pb-24");
    expect(
      screen.getByRole("button", { name: "Choose who is on it" }).parentElement?.className,
    ).toContain("sticky");
  });

  it("names a person with no name and lets a choice be undone", async () => {
    const user = userEvent.setup();
    sheet();
    await user.click(screen.getByRole("button", { name: /^Someone\s*Select$/ }));
    expect(screen.getByLabelText(/Team name/)).toHaveValue("Someone");
    await user.click(screen.getByRole("button", { name: /^Someone\s*Selected$/ }));
    expect(screen.getByRole("button", { name: "Choose who is on it" })).toBeDisabled();
  });

  it("names the team in the order people were picked", async () => {
    const user = userEvent.setup();
    sheet();
    await user.click(screen.getByRole("button", { name: /Cy Ong/ }));
    await user.click(screen.getByRole("button", { name: /Ada Admin/ }));
    expect(screen.getByLabelText(/Team name/)).toHaveValue("Cy & Ada");
  });

  it("keeps a typed name when the people change", async () => {
    const user = userEvent.setup();
    const props = sheet();
    await user.click(screen.getByRole("button", { name: /Cy Ong/ }));
    await user.clear(screen.getByLabelText(/Team name/));
    await user.type(screen.getByLabelText(/Team name/), "Night shift");
    await user.click(screen.getByRole("button", { name: /Ada Admin/ }));
    expect(screen.getByText("11 of 60")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create team" }));
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: "Night shift",
      memberIds: ["cy", "admin"],
    });
  });

  it("refuses a blank or unshowable name before sending", async () => {
    const user = userEvent.setup();
    const props = sheet({ mode: "rename", initialName: "North" });
    await user.clear(screen.getByLabelText(/Team name/));
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a team name.");

    await user.type(screen.getByLabelText(/Team name/), "​");
    expect(screen.getByText(/characters that cannot be shown/)).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("says when nobody is free to place", () => {
    sheet({ mode: "add", candidates: [] });
    expect(
      screen.getByText("Everyone active is already on a team in this session."),
    ).toBeInTheDocument();
  });

  it("says why it cannot send while offline", () => {
    sheet({ mode: "rename", initialName: "North", canChange: false });
    expect(screen.getByText("Connect to change teams")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
  });

  it("keeps the input and shows the reason when the server refuses", async () => {
    const user = userEvent.setup();
    sheet({ mode: "rename", initialName: "North", onSubmit: vi.fn().mockRejectedValue("boom") });
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not change/);
    expect(screen.getByLabelText(/Team name/)).toHaveValue("North");
  });

  it("sends once for a double tap", async () => {
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    sheet({ mode: "rename", initialName: "North", onSubmit });
    const save = screen.getByRole("button", { name: "Save name" });
    /* One act: no re-render between the taps, so only the ref guard holds. */
    act(() => {
      save.click();
      save.click();
    });
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("closes from the backdrop and from Cancel", async () => {
    const user = userEvent.setup();
    const props = sheet();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("is a modal: focus moves in and Escape closes", async () => {
    const props = sheet();
    expect(screen.getByRole("dialog", { name: "New team" })).toHaveFocus();
    await userEvent.setup().keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
