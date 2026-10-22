import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamSheet } from "@/components/teams/team-sheet";

/* The card's own in-flight guard also stops a repeat, so the sheet's guard is
   tested alone here: two taps before React re-renders, one submit. */
describe("TeamSheet", () => {
  it("submits once for two taps in one frame", async () => {
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <TeamSheet
        mode="rename"
        myName="Ann Tan"
        initialName="Ann & Ben"
        candidates={[]}
        canChange
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    const save = screen.getByRole("button", { name: "Save name" });
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

  it("is a modal: focus moves in and Escape closes", () => {
    const onClose = vi.fn();
    render(
      <TeamSheet
        mode="create"
        myName="Ann Tan"
        initialName=""
        candidates={[]}
        canChange
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
    );
    // The panel, not the name field: a phone would raise the keyboard unasked.
    expect(screen.getByRole("dialog", { name: "Pair up" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
