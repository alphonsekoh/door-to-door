import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Sheet, SheetActions, SheetPresence } from "@/components/ui/sheet";

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

/* The real spring, so there is an entrance to interrupt. */
function realSpring() {
  MotionGlobalConfig.skipAnimations = false;
  onTestFinished(() => {
    MotionGlobalConfig.skipAnimations = true;
  });
}

function rendered() {
  render(
    <Sheet label="Edit" title="Edit" onClose={vi.fn()}>
      <p>Body</p>
    </Sheet>,
  );
  const panel = screen.getByRole("dialog", { name: "Edit" });
  const handle = screen.getByText("Edit", { selector: "p" }).closest(".touch-none");
  if (!(handle instanceof HTMLElement)) throw new Error("no drag handle");
  return { panel, handle };
}

/* Partway up: drawn, but not yet at rest. */
async function rising(panel: HTMLElement) {
  await waitFor(() => {
    const percent = Number(/translateY\(([\d.]+)%\)/.exec(panel.style.transform)?.[1]);
    expect(percent).toBeGreaterThan(5);
    expect(percent).toBeLessThan(95);
  });
}

/*
 * The fastest the panel moves between two drawn frames over the next `ms`,
 * in px/s. A spring that sets off from rest starts slow, so a fast first
 * frame is the finger's speed handed on.
 */
async function topSpeed(panel: HTMLElement, ms: number): Promise<number> {
  const frames: { at: number; y: number }[] = [];
  const observer = new MutationObserver(() => {
    const match = /translateY\((-?[\d.]+)px\)/.exec(panel.style.transform);
    if (match !== null) frames.push({ at: performance.now(), y: Number(match[1]) });
  });
  observer.observe(panel, { attributes: true, attributeFilter: ["style"] });
  await new Promise((resolve) => setTimeout(resolve, ms));
  observer.disconnect();
  let top = 0;
  for (const [index, frame] of frames.entries()) {
    const before = frames[index - 1];
    if (before === undefined || frame.at - before.at < 5) continue;
    top = Math.max(top, (Math.abs(frame.y - before.y) / (frame.at - before.at)) * 1000);
  }
  return top;
}

/* The panel's offset in px while it is dragged. */
function offset(panel: HTMLElement): number {
  const match = /translateY\((-?[\d.]+)px\)/.exec(panel.style.transform);
  if (match === null) throw new Error(`not dragged: ${panel.style.transform}`);
  return Number(match[1]);
}

/* The dimming layer, inside the backdrop button. */
function scrim(): HTMLElement {
  const layer = document.querySelector('[data-state="open"] button[aria-label="Close"] > span');
  if (!(layer instanceof HTMLElement)) throw new Error("no scrim");
  return layer;
}

const NOTE = { title: "Discard this note?", detail: "What you typed has not been saved." };

/* A sheet holding typed work, so a stray pull or tap must ask first. */
async function openHolding(onClose = vi.fn<() => void>()) {
  render(
    <Sheet label="Edit" title="Edit" onClose={onClose} discard={NOTE}>
      <textarea aria-label="Note" defaultValue="Call after six" />
    </Sheet>,
  );
  const panel = screen.getByRole("dialog", { name: "Edit" });
  const handle = screen.getByText("Edit", { selector: "p" }).closest(".touch-none");
  if (!(handle instanceof HTMLElement)) throw new Error("no drag handle");
  await settled(panel);
  return { panel, handle, onClose };
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

  it("settles back when the finger stops before it lets go", async () => {
    const { panel, handle, onClose } = await open();
    // A quarter of the way down at about 330 px/s, which would carry it past
    // the line, then held still: a still finger sends no moves at all.
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    for (const y of [127, 143, 160, 177, 193, 210, 227, 243, 260]) {
      now += 50;
      fireEvent.pointerMove(panel, { pointerId: 1, clientY: y });
    }
    now += 150;
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 260 });
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

  it("finishes rising when its header is tapped mid-entrance", async () => {
    realSpring();
    const { panel, handle } = rendered();
    await rising(panel);
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 100 });
    // Not left resting partway, with Save below the screen.
    await waitFor(
      () => {
        expect(panel.style.transform).toBe("none");
      },
      { timeout: 3000 },
    );
  });

  it("follows the finger, not the entrance, when grabbed mid-entrance", async () => {
    realSpring();
    const { panel, handle } = rendered();
    await rising(panel);
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 120 });
    // Motion draws the drag on the next frame.
    const held = await waitFor(() => offset(panel));
    // Long enough for a running spring to have moved it a long way.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(offset(panel)).toBe(held);
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 150 });
    await waitFor(() => {
      expect(offset(panel)).toBe(held + 30);
    });
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

  it("opens at its top, though the control it focuses is at its foot", () => {
    /* As a browser does at large text: bringing OK into view scrolls the
       body down to it, past the heading. */
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      const body = this.closest('[role="alertdialog"] > div');
      if (body instanceof HTMLElement) body.scrollTop = 400;
    });
    function Tall() {
      const ok = useRef<HTMLButtonElement>(null);
      return (
        <Sheet
          label="Not saved"
          role="alertdialog"
          layer="dialog"
          draggable={false}
          initialFocus={ok}
          onClose={vi.fn()}
        >
          <p>Not saved</p>
          <button ref={ok} type="button">
            OK
          </button>
        </Sheet>
      );
    }
    render(<Tall />);
    const ok = screen.getByRole("button", { name: "OK" });
    expect(ok).toHaveFocus();
    expect(ok.parentElement?.scrollTop).toBe(0);
  });

  it("lightens its scrim as it is pulled down, and darkens it again as it settles", async () => {
    const { panel, handle } = await open();
    expect(Number(scrim().style.opacity)).toBe(1);
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 160 });
    // 50 px of a 600 px sheet, once the 10 px that start a drag are taken.
    await waitFor(() => {
      expect(Number(scrim().style.opacity)).toBeCloseTo(0.92, 2);
    });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 260 });
    // 150 px of a 600 px sheet: a quarter of the way to clear.
    await waitFor(() => {
      expect(Number(scrim().style.opacity)).toBeCloseTo(0.75, 2);
    });
    // Held still, then let go: it goes back.
    now += 400;
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 260 });
    await settled(panel);
    expect(Number(scrim().style.opacity)).toBe(1);
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

describe("Sheet holding unsaved work", () => {
  it("gives under a pull rather than following it, springs back, and asks", async () => {
    const { panel, handle, onClose } = await openHolding();
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 410 });
    // 300 px of finger moves it much less: it can be tugged, not thrown.
    await waitFor(() => {
      expect(offset(panel)).toBeGreaterThan(0);
    });
    expect(offset(panel)).toBeLessThan(300);
    now += 400;
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 410 });

    expect(onClose).not.toHaveBeenCalled();
    const ask = await screen.findByRole("alertdialog", { name: "Discard this note?" });
    expect(ask).toHaveTextContent("What you typed has not been saved.");
    await settled(panel);
  });

  it("keeps the work, and the sheet, when the answer is to keep editing", async () => {
    const user = userEvent.setup();
    const { onClose } = await openHolding();
    await user.click(screen.getByRole("button", { name: "Close" }));
    const ask = screen.getByRole("alertdialog", { name: "Discard this note?" });
    // Focus lands on the way out of the question, not on Discard.
    expect(within(ask).getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(within(ask).getByRole("button", { name: "Keep editing" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("Note")).toHaveValue("Call after six");
    // Back on the sheet, not on the backdrop that was tapped.
    expect(screen.getByRole("dialog", { name: "Edit" })).toHaveFocus();
  });

  it("asks after a flick, and closes once the answer is to discard", async () => {
    const user = userEvent.setup();
    const { panel, handle, onClose } = await openHolding();
    // About 1250 px/s, which would throw an empty sheet away.
    drag(panel, handle, [130, 150, 170]);
    expect(onClose).not.toHaveBeenCalled();
    const ask = await screen.findByRole("alertdialog", { name: "Discard this note?" });
    await user.click(within(ask).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before a tap on the backdrop throws the work away", async () => {
    const user = userEvent.setup();
    const { onClose } = await openHolding();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Discard this note?" })).toBeInTheDocument();
  });

  it("just settles back from a short pull, with nothing to ask", async () => {
    const { panel, handle, onClose } = await openHolding();
    drag(panel, handle, [140, 160, 160, 160], 60);
    await settled(panel);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes at once on Cancel or Escape, which are deliberate answers already", async () => {
    const user = userEvent.setup();
    const { onClose } = await openHolding();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is grabbed where it is while it springs back, without a jump", async () => {
    realSpring();
    const { panel, handle } = await openHolding();
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 410 });
    const pulled = await waitFor(() => offset(panel));
    now += 400;
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 410 });
    // Taken again partway back, and moved on by a few px.
    await waitFor(() => {
      expect(offset(panel)).toBeLessThan(pulled * 0.8);
    });
    const before = offset(panel);
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 111 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const held = offset(panel);
    // Where it was, give or take the frame it was drawn in: read as a fresh
    // pull from rest it would leap back to half that.
    expect(Math.abs(held - before)).toBeLessThan(20);
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 116 });
    await waitFor(() => {
      expect(offset(panel)).not.toBe(held);
    });
    // A few px of finger moves it a few px, not back to where it was let go.
    expect(Math.abs(offset(panel) - held)).toBeLessThan(5);
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

  it("leaves at the speed it was thrown, not stalling and setting off from rest", async () => {
    realSpring();
    const user = userEvent.setup();
    render(<Host onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const panel = screen.getByRole("dialog", { name: "Edit" });
    await waitFor(
      () => {
        expect(panel.style.transform).toBe("none");
      },
      { timeout: 3000 },
    );
    const handle = screen.getByText("Edit", { selector: "p" }).closest(".touch-none");
    if (!(handle instanceof HTMLElement)) throw new Error("no drag handle");

    // Down 240 px, then 160 px more in 16 ms, about 10 000 px/s.
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    for (const [y, step] of [
      [130, 100],
      [350, 100],
      [510, 16],
    ] as const) {
      now += step;
      fireEvent.pointerMove(panel, { pointerId: 1, clientY: y });
    }
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 510 });
    // From rest, 200 px short of the bottom, this spring is never faster
    // than about 1100 px/s.
    expect(await topSpeed(panel, 150)).toBeGreaterThan(3000);
  });

  it("settles back at the speed it was thrown up", async () => {
    realSpring();
    const { panel, handle } = rendered();
    await waitFor(
      () => {
        expect(panel.style.transform).toBe("none");
      },
      { timeout: 3000 },
    );
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    now += 100;
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 330 });
    now += 100;
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 340 });
    // Down 230 px, then 160 px back up in 16 ms.
    now += 16;
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 180 });
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 180 });
    // From rest, 70 px down, this spring is never faster than about 450 px/s.
    expect(await topSpeed(panel, 150)).toBeGreaterThan(3000);
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

describe("SheetActions", () => {
  function Held({ note, docked = true }: { note: string | null; docked?: boolean }) {
    return (
      <Sheet label="Suggest" onClose={vi.fn()}>
        <textarea aria-label="Note" />
        {docked ? (
          <SheetActions note={note} noteId="send-note">
            <button type="button" disabled={note !== null} aria-describedby="send-note">
              Send
            </button>
          </SheetActions>
        ) : null}
      </Sheet>
    );
  }

  it("says why its action is held back, for the action to be described by", () => {
    const { rerender } = render(<Held note="Connect to change follow-ups" />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Connect to change follow-ups");

    rerender(<Held note={null} />);
    expect(send).toBeEnabled();
    expect(screen.queryByText("Connect to change follow-ups")).toBeNull();
  });

  /* jsdom lays nothing out: the bar is as tall as `bar` says, and the
     browser's resize callbacks are made by hand. */
  it("tells its sheet's body how tall it is drawn, as its note comes and goes", () => {
    let bar = 80;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("sticky") ? bar : 600;
    });
    const observers: { measure: () => void; watched: Element[]; disconnect: () => void }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        watched: Element[] = [];
        disconnect = vi.fn();
        constructor(measure: () => void) {
          observers.push({ measure, watched: this.watched, disconnect: this.disconnect });
        }
        observe(target: Element) {
          this.watched.push(target);
        }
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const { rerender } = render(<Held note={null} />);
    const body = screen.getByLabelText("Note").parentElement;
    if (body === null) throw new Error("no sheet body");
    const room = () => body.style.getPropertyValue("--sheet-actions");
    expect(room()).toBe("80px");

    // Offline, the note takes a line or two above Send.
    bar = 136;
    rerender(<Held note="Connect to change follow-ups" />);
    const send = screen.getByRole("button", { name: "Send" }).parentElement;
    act(() => {
      for (const observer of observers) {
        if (send !== null && observer.watched.includes(send)) observer.measure();
      }
    });
    expect(room()).toBe("136px");

    // With no bar docked, there is nothing to clear.
    rerender(<Held note={null} docked={false} />);
    expect(room()).toBe("");
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });
});
