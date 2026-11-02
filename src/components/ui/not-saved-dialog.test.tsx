import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NotSavedDialog } from "@/components/ui/not-saved-dialog";
import { SheetPresence } from "@/components/ui/sheet";

const LEAD = "This visit could not be saved because:";
const REASONS = ["The unit number is blank.", "No interest level is chosen."];

const dialog = () => within(screen.getByRole("alertdialog", { name: "Not saved" }));

describe("NotSavedDialog", () => {
  it("is an alert named Not saved that lists every reason under its lead", () => {
    render(
      <NotSavedDialog lead={LEAD} reasons={REASONS} returnFocus={undefined} onDismiss={vi.fn()} />,
    );
    expect(dialog().getByText(LEAD)).toBeInTheDocument();
    expect(
      dialog()
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(REASONS);
  });

  it("opens on OK, so Enter or a tap dismisses it", () => {
    render(
      <NotSavedDialog lead={LEAD} reasons={REASONS} returnFocus={undefined} onDismiss={vi.fn()} />,
    );
    expect(dialog().getByRole("button", { name: "OK" })).toHaveFocus();
  });

  it("sits above the sheets and the docked Save", () => {
    render(
      <NotSavedDialog lead={LEAD} reasons={REASONS} returnFocus={undefined} onDismiss={vi.fn()} />,
    );
    expect(screen.getByRole("alertdialog").parentElement).toHaveClass("z-60");
  });

  it("is dismissed by OK, by Escape and by the backdrop", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <NotSavedDialog
        lead={LEAD}
        reasons={REASONS}
        returnFocus={undefined}
        onDismiss={onDismiss}
      />,
    );
    await user.click(dialog().getByRole("button", { name: "OK" }));
    await user.keyboard("{Escape}");
    // The backdrop sits outside the panel; a tap there means the same.
    const [backdrop] = screen
      .getAllByRole("button", { name: "OK" })
      .filter((button) => !screen.getByRole("alertdialog").contains(button));
    if (backdrop === undefined) throw new Error("no backdrop");
    await user.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });

  it("sends focus to the field it names once it has gone", async () => {
    function Form() {
      const unit = useRef<HTMLInputElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <input ref={unit} aria-label="Unit number" />
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Save
          </button>
          <SheetPresence>
            {open ? (
              <NotSavedDialog
                lead={LEAD}
                reasons={REASONS}
                returnFocus={unit}
                onDismiss={() => {
                  setOpen(false);
                }}
              />
            ) : null}
          </SheetPresence>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(dialog().getByRole("button", { name: "OK" }));
    expect(screen.getByLabelText("Unit number")).toHaveFocus();
  });
});
