import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModal } from "@/lib/use-modal";

function Sheet({
  label,
  onClose,
  focusSecond = false,
  children,
}: {
  label: string;
  onClose: () => void;
  focusSecond?: boolean;
  children?: ReactNode;
}) {
  const second = useRef<HTMLButtonElement>(null);
  const { overlay, panel } = useModal(onClose, focusSecond ? second : undefined);
  return (
    <div ref={overlay}>
      <button type="button" aria-label={`Backdrop ${label}`} onClick={onClose} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-label={label}>
        <button type="button">{label} first</button>
        <button type="button" disabled>
          {label} disabled
        </button>
        <button ref={second} type="button">
          {label} second
        </button>
        <input aria-label={`${label} last`} />
        {children}
      </div>
    </div>
  );
}

/* A page with a trigger, and a sheet that can raise a confirm of its own. */
function Page({ onSheetClose = vi.fn<() => void>() }: { onSheetClose?: () => void }) {
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <main>
        <button
          type="button"
          onClick={() => {
            setSheet(true);
          }}
        >
          Open
        </button>
      </main>
      {sheet ? (
        <Sheet
          label="Sheet"
          onClose={() => {
            onSheetClose();
            setSheet(false);
          }}
        >
          <button
            type="button"
            onClick={() => {
              setConfirm(true);
            }}
          >
            Delete
          </button>
          {confirm ? (
            <Sheet
              label="Confirm"
              onClose={() => {
                setConfirm(false);
              }}
            >
              {/* As a confirmed delete does: the sheet goes, taking the confirm with it. */}
              <button
                type="button"
                onClick={() => {
                  setSheet(false);
                }}
              >
                Confirm and close
              </button>
            </Sheet>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useModal", () => {
  it("moves focus into the dialog on open, onto the panel by default", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Sheet" })).toHaveFocus();
  });

  it("focuses the control the caller names instead", () => {
    render(<Sheet label="Sheet" onClose={vi.fn()} focusSecond />);
    expect(screen.getByRole("button", { name: "Sheet second" })).toHaveFocus();
  });

  it("cycles Tab through the dialog's enabled controls and wraps at both ends", async () => {
    const user = userEvent.setup();
    render(<Sheet label="Sheet" onClose={vi.fn()} />);
    const first = screen.getByRole("button", { name: "Sheet first" });
    const second = screen.getByRole("button", { name: "Sheet second" });
    const last = screen.getByRole("textbox", { name: "Sheet last" });

    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(second).toHaveFocus();
    await user.tab();
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab({ shift: true });
    expect(second).toHaveFocus();
  });

  it("sends Shift+Tab from the panel itself to the last control", async () => {
    const user = userEvent.setup();
    render(<Sheet label="Sheet" onClose={vi.fn()} />);
    await user.tab({ shift: true });
    expect(screen.getByRole("textbox", { name: "Sheet last" })).toHaveFocus();
  });

  it("never lets Tab reach the backdrop", async () => {
    const user = userEvent.setup();
    render(<Sheet label="Sheet" onClose={vi.fn()} />);
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(screen.getByRole("button", { name: "Backdrop Sheet" })).not.toHaveFocus();
    }
  });

  it("holds focus on a panel with nothing to tab to", async () => {
    function Empty() {
      const { overlay, panel } = useModal(vi.fn());
      return (
        <div ref={overlay}>
          <div ref={panel} tabIndex={-1} role="dialog" aria-label="Empty">
            Nothing here.
          </div>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Empty />);
    await user.tab();
    expect(screen.getByRole("dialog", { name: "Empty" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    const onSheetClose = vi.fn();
    render(<Page onSheetClose={onSheetClose} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");

    expect(onSheetClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("leaves an Escape that ends an IME composition to the text field", () => {
    const onClose = vi.fn();
    render(<Sheet label="Sheet" onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves other keys alone", () => {
    render(<Sheet label="Sheet" onClose={vi.fn()} />);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    screen.getByRole("textbox").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("calls the latest onClose, not the one it opened with", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Sheet label="Sheet" onClose={first} />);
    rerender(<Sheet label="Sheet" onClose={latest} />);
    await userEvent.setup().keyboard("{Escape}");
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("makes the page behind inert while open and wakes it on close", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const main = screen.getByRole("main");
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(main).toHaveAttribute("inert");
    expect(screen.getByRole("dialog", { name: "Sheet" })).not.toHaveAttribute("inert");
    // The backdrop stays live: tapping it is how a sheet closes.
    expect(screen.getByRole("button", { name: "Backdrop Sheet" })).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Backdrop Sheet" }));
    expect(main).not.toHaveAttribute("inert");
  });

  it("does not wake something that was inert before it opened", () => {
    const asleep = document.createElement("div");
    asleep.setAttribute("inert", "");
    document.body.append(asleep);

    const { unmount } = render(<Sheet label="Sheet" onClose={vi.fn()} />);
    unmount();
    expect(asleep).toHaveAttribute("inert");
    asleep.remove();
  });

  it("stops the page scrolling while open and restores what was there", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = render(<Sheet label="Sheet" onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("does not try to return focus to a trigger that has gone", async () => {
    function Vanishing() {
      const [open, setOpen] = useState(false);
      return open ? (
        <Sheet
          label="Sheet"
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Open
        </button>
      );
    }
    const user = userEvent.setup();
    render(<Vanishing />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    // The new Open button is a different element; focus is not forced onto it.
    expect(screen.getByRole("button", { name: "Open" })).not.toHaveFocus();
  });

  it("does nothing when its refs are never attached", () => {
    function Unattached() {
      useModal(vi.fn());
      return <p>Plain</p>;
    }
    render(<Unattached />);
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByText("Plain")).not.toHaveFocus();
  });

  describe("with a confirm raised from a sheet", () => {
    async function openBoth() {
      const user = userEvent.setup();
      const onSheetClose = vi.fn();
      render(<Page onSheetClose={onSheetClose} />);
      await user.click(screen.getByRole("button", { name: "Open" }));
      await user.click(screen.getByRole("button", { name: "Delete" }));
      return { user, onSheetClose };
    }

    it("traps Tab inside the confirm, not the sheet beneath", async () => {
      const { user } = await openBoth();
      expect(screen.getByRole("dialog", { name: "Confirm" })).toHaveFocus();
      for (let i = 0; i < 5; i += 1) {
        await user.tab();
        expect(screen.getByRole("dialog", { name: "Confirm" })).toContainElement(
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        );
      }
    });

    it("makes the sheet inert while the confirm is up", async () => {
      await openBoth();
      expect(screen.getByRole("button", { name: "Sheet first" })).toHaveAttribute("inert");
      expect(screen.getByRole("button", { name: "Backdrop Sheet" })).toHaveAttribute("inert");
      expect(screen.getByRole("main")).toHaveAttribute("inert");
    });

    it("closes only the top layer on Escape and hands focus back to the sheet", async () => {
      const { user, onSheetClose } = await openBoth();
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("dialog", { name: "Confirm" })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Sheet" })).toBeInTheDocument();
      expect(onSheetClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "Sheet first" })).not.toHaveAttribute("inert");
      expect(screen.getByRole("main")).toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("hidden");

      await user.keyboard("{Escape}");
      expect(onSheetClose).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
      expect(document.body.style.overflow).toBe("");
    });

    it("cleans up when the sheet and its confirm close together", async () => {
      const { user } = await openBoth();
      await user.click(screen.getByRole("button", { name: "Confirm and close" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("main")).not.toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("");
      expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
    });
  });
});
