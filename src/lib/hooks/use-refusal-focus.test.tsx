import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { nextFrame } from "../../../test/next-frame";

type Answer = (accepted: boolean) => void;

/* The shape of every place that uses it: Go is disabled while its attempt is
   out, and a refusal is said in an alert, which a layout effect of its own
   then brings into view. A second refusal says the same again. */
function Attempt({
  attempt,
  goes = false,
  onDrawn = () => undefined,
}: {
  attempt: () => Promise<boolean>;
  /* Go leaves the page while busy, and a new one comes back. */
  goes?: boolean;
  onDrawn?: (focused: Element | null) => void;
}) {
  const { notePress, refused } = useRefusalFocus();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    if (failed) onDrawn(document.activeElement);
  }, [failed, onDrawn]);

  async function go(): Promise<void> {
    notePress();
    setBusy(true);
    const accepted = await attempt();
    setBusy(false);
    if (!accepted) {
      setFailed(true);
      refused();
    }
  }

  return (
    <div role="dialog" aria-label="Panel" tabIndex={-1}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void go();
        }}
      >
        <input aria-label="Unit" />
        {goes && busy ? null : (
          <button type="submit" disabled={busy}>
            Go
          </button>
        )}
      </form>
      <button type="button">Elsewhere</button>
      <button type="button" onClick={refused}>
        Refuse
      </button>
      {failed ? <p role="alert">Refused.</p> : null}
    </div>
  );
}

/* An attempt the test answers by hand, once focus has had its frame to drop. */
function held(): { attempt: () => Promise<boolean>; answer: Answer } {
  let answer: Answer = () => undefined;
  return {
    attempt: () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    answer: (accepted) => {
      answer(accepted);
    },
  };
}

const go = () => screen.getByRole("button", { name: "Go" });

let focused: MockInstance<HTMLElement["focus"]>;

beforeEach(() => {
  focused = vi.spyOn(HTMLElement.prototype, "focus");
});

afterEach(() => {
  focused.mockRestore();
});

/* Pressed and disabled past a frame; then refused, and drawn: Go is enabled
   again as the refusal is said, which a second refusal does not change. */
async function refusedAfterADrop(press: () => Promise<void> | void, answer: Answer) {
  await press();
  expect(go()).toBeDisabled();
  await nextFrame();
  return async () => {
    answer(false);
    await waitFor(() => {
      expect(go()).toBeEnabled();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  };
}

describe("useRefusalFocus", () => {
  it("gives focus back to the pressed button the page took it from, without a scroll", async () => {
    const { attempt, answer } = held();
    const user = userEvent.setup();
    render(<Attempt attempt={attempt} />);
    const button = go();

    const refuse = await refusedAfterADrop(() => user.click(button), answer);
    // Disabled while the attempt is out, Go has lost focus to the page.
    expect(document.body).toHaveFocus();
    focused.mockClear();

    await refuse();
    expect(button).toHaveFocus();
    expect(focused.mock.contexts).toEqual([button]);
    expect(focused).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does it as the refusal is drawn, before the place's own effect brings it into view", async () => {
    const { attempt, answer } = held();
    const onDrawn = vi.fn();
    const user = userEvent.setup();
    render(<Attempt attempt={attempt} onDrawn={onDrawn} />);

    const refuse = await refusedAfterADrop(() => user.click(go()), answer);
    expect(document.body).toHaveFocus();
    await refuse();
    expect(onDrawn).toHaveBeenCalledExactlyOnceWith(go());
  });

  it("gives it back for a second refusal identical to the first", async () => {
    const { attempt, answer } = held();
    const user = userEvent.setup();
    render(<Attempt attempt={attempt} />);

    const first = await refusedAfterADrop(() => user.click(go()), answer);
    await first();
    expect(go()).toHaveFocus();

    const second = await refusedAfterADrop(() => user.click(go()), answer);
    expect(document.body).toHaveFocus();
    await second();
    expect(go()).toHaveFocus();
  });

  it("leaves focus in the field Go was pressed from", async () => {
    const { attempt, answer } = held();
    const user = userEvent.setup();
    render(<Attempt attempt={attempt} />);
    const unit = screen.getByLabelText("Unit");

    const refuse = await refusedAfterADrop(() => user.type(unit, "#05{Enter}"), answer);
    expect(unit).toHaveFocus();
    await refuse();
    expect(unit).toHaveFocus();
  });

  /* An iPhone tap focuses no button: on the page, or on a sheet's panel,
     which is inside the modal (D-90-2). */
  it.each([
    ["the page", () => document.body],
    ["a sheet's panel", () => screen.getByRole("dialog", { name: "Panel" })],
  ])("moves nothing after a press that focused no button, from %s", async (_where, start) => {
    const { attempt, answer } = held();
    render(<Attempt attempt={attempt} />);
    act(() => {
      start().focus();
    });

    const refuse = await refusedAfterADrop(() => {
      fireEvent.click(go());
    }, answer);
    expect(start()).toHaveFocus();
    focused.mockClear();

    await refuse();
    expect(start()).toHaveFocus();
    expect(focused).not.toHaveBeenCalled();
  });

  it("leaves focus where the member put it while the attempt was out", async () => {
    const { attempt, answer } = held();
    const user = userEvent.setup();
    render(<Attempt attempt={attempt} />);

    const refuse = await refusedAfterADrop(() => user.click(go()), answer);
    expect(document.body).toHaveFocus();
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    await user.click(elsewhere);

    await refuse();
    expect(elsewhere).toHaveFocus();
  });

  it("gives nothing back for a refusal no press came before", () => {
    render(<Attempt attempt={() => Promise.resolve(false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    expect(document.body).toHaveFocus();
    expect(focused).not.toHaveBeenCalled();
  });

  it("gives a press back once: a later refusal with no press of its own moves nothing", async () => {
    const { attempt, answer } = held();
    const user = userEvent.setup();
    render(<Attempt attempt={attempt} />);

    const refuse = await refusedAfterADrop(() => user.click(go()), answer);
    await refuse();
    expect(go()).toHaveFocus();

    act(() => {
      go().blur();
    });
    focused.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    expect(document.body).toHaveFocus();
    expect(focused).not.toHaveBeenCalled();
  });

  it("leaves focus on the page when the pressed button left it before the refusal", async () => {
    const { attempt, answer } = held();
    const user = userEvent.setup();
    render(<Attempt attempt={attempt} goes />);

    await user.click(go());
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
    expect(document.body).toHaveFocus();

    answer(false);
    await screen.findByRole("alert");
    expect(document.body).toHaveFocus();
    expect(go()).not.toHaveFocus();
  });
});
