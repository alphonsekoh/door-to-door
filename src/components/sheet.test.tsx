import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Sheet, SheetPresence } from "@/components/sheet";

/*
 * jsdom lays nothing out and has no pointer capture: give the panel a height
 * and capture a no-op, and drive the clock the drag measures velocity by.
 */
let now = 0;
beforeEach(() => {
  now = 0;
  // Real time keeps running for the frame loop; `now` adds the drag's own.
  const real = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(() => real() + now);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* Opened and risen: a drag then starts from rest. */
async function open(onClose = vi.fn<() => void>()) {
  render(
    <Sheet label="Edit" title="Edit" onClose={onClose}>
      <p>Body</p>
    </Sheet>,
  );
  const panel = screen.getByRole("dialog", { name: "Edit" });
  // The drag handle is the header: the grabber and the title row.
  const handle = screen.getByText("Edit", { selector: "p" }).closest(".touch-none");
  if (!(handle instanceof HTMLElement)) throw new Error("no drag handle");
  await settled(panel);
  return { panel, handle, onClose };
}

/* Motion draws on the next frame. */
async function settled(panel: HTMLElement, transform = "none") {
  await waitFor(() => {
    expect(panel.style.transform).toBe(transform);
  });
}

/* A drag of the handle from y=100 through each point, `step` ms apart. */
function drag(panel: HTMLElement, handle: HTMLElement, points: number[], step = 16) {
  fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
  for (const y of points) {
    now += step;
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: y });
  }
  fireEvent.pointerUp(panel, { pointerId: 1, clientY: points.at(-1) });
}

describe("Sheet", () => {
  it("renders on the body, out of any parent that could offset a fixed overlay", () => {
    render(
      <div className="space-y-5" data-testid="parent">
        <Sheet label="Edit" onClose={vi.fn()}>
          <p>Body</p>
        </Sheet>
      </div>,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit" });
    expect(screen.getByTestId("parent")).not.toContainElement(dialog);
    expect(dialog.closest(".fixed")?.parentElement).toBe(document.body);
  });

  it("is a modal: focus moves in, Escape and the backdrop close it", async () => {
    const user = userEvent.setup();
    const { panel, onClose } = await open();
    expect(panel).toHaveFocus();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("follows the finger down from where it was grabbed", async () => {
    const { panel, handle } = await open();
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 180 });
    // 80 px moved, less the 10 px it took to tell a drag from a tap.
    await settled(panel, "translateY(70px)");
  });

  it("dismisses when dragged far enough down", async () => {
    const { panel, handle, onClose } = await open();
    drag(panel, handle, [150, 250, 360, 360, 360], 40);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("dismisses on a quick flick that has not travelled far", async () => {
    const { panel, handle, onClose } = await open();
    // 60 px in 48 ms is about 1250 px/s, well past a flick.
    drag(panel, handle, [130, 150, 170]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("settles back from a short, slow drag", async () => {
    const { panel, handle, onClose } = await open();
    drag(panel, handle, [140, 160, 160, 160], 60);
    expect(onClose).not.toHaveBeenCalled();
    await settled(panel);
  });

  it("settles back when the drag is cancelled, however far it went", async () => {
    const { panel, handle, onClose } = await open();
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    now += 16;
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 500 });
    fireEvent.pointerCancel(panel, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resists being pulled up past its resting place", async () => {
    const { panel, handle } = await open();
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 300 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 110 });
    await waitFor(() => {
      const moved = Number(/translateY\((-?[\d.]+)px\)/.exec(panel.style.transform)?.[1]);
      // 180 px of pull past the top shows as much less.
      expect(moved).toBeLessThan(0);
      expect(moved).toBeGreaterThan(-180);
    });
  });

  it("treats a tap on the header as a tap, not a drag", async () => {
    const { panel, handle, onClose } = await open();
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 104 });
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 104 });
    await settled(panel);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores a second finger, and moves from another pointer", async () => {
    const { panel, handle } = await open();
    fireEvent.pointerDown(handle, { pointerId: 2, isPrimary: false, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 2, clientY: 300 });
    await settled(panel);
  });

  it("brings a field that takes focus fully into view, and leaves the panel itself alone", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    render(
      <Sheet label="Edit" title="Edit" onClose={vi.fn()}>
        <input aria-label="Name" />
      </Sheet>,
    );
    // Focus on open lands on the panel, which is not scrolled to.
    expect(scrolled).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByLabelText("Name"));
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrolled.mock.contexts[0]).toBe(screen.getByLabelText("Name"));
  });

  it("has no drag handle when it asks for a deliberate answer", () => {
    render(
      <Sheet label="Sure?" role="alertdialog" layer="dialog" draggable={false} onClose={vi.fn()}>
        <p>Body</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Sure?" });
    expect(dialog.querySelector(".touch-none")).toBeNull();
    expect(dialog.closest(".fixed")).toHaveClass("z-60");
  });
});

describe("Sheet leaving", () => {
  /* A sheet with a draft of its own, as every form sheet has. */
  function Draft({ onClose }: { onClose: () => void }) {
    const [text, setText] = useState("");
    return (
      <Sheet label="Edit" title="Edit" onClose={onClose}>
        <input
          aria-label="Note"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </Sheet>
    );
  }

  function Host({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Open
        </button>
        <SheetPresence>
          {open ? (
            <Draft
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            />
          ) : null}
        </SheetPresence>
      </>
    );
  }

  it("hands back focus as it starts to leave, and cannot be closed twice on the way out", async () => {
    // The real spring, so there is a way out to watch.
    MotionGlobalConfig.skipAnimations = false;
    onTestFinished(() => {
      MotionGlobalConfig.skipAnimations = true;
    });
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();

    // Still drawn while it slides away, but inert: no second close.
    const leaving = document.querySelector('[data-state="closed"]');
    expect(leaving).toHaveAttribute("inert");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();

    await waitFor(
      () => {
        expect(document.querySelector('[data-state="closed"]')).toBeNull();
      },
      { timeout: 3000 },
    );
  });

  it("opens fresh when reopened while the last one is still leaving", async () => {
    MotionGlobalConfig.skipAnimations = false;
    onTestFinished(() => {
      MotionGlobalConfig.skipAnimations = true;
    });
    const user = userEvent.setup();
    render(<Host onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.type(screen.getByLabelText("Note"), "Saved already");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.querySelector('[data-state="closed"]')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Open" }));
    // A new sheet rising past the old one, not the leaving one brought back
    // with the draft it had.
    const fresh = screen.getByRole("dialog", { name: "Edit" });
    expect(within(fresh).getByLabelText("Note")).toHaveValue("");
  });
});
