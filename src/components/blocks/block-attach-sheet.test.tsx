import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { BlockAttachSheet } from "@/components/blocks/block-attach-sheet";
import type { Block } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { focusDropped, pressByKey } from "../../../test/focus-dropped";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
}));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const block = (id: string, name: string): Block => ({
  id,
  name,
  street: "Test Ave",
  postalCode: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const page = (rows: Block[]) => ({
  data: rows,
  pagination: { limit: 50, offset: 0, total: rows.length, hasMore: false },
});

beforeEach(() => {
  vi.clearAllMocks();
});

/* The sheet lists the registry as it opens, asynchronously, so that
   listing can land at any point in a test that does not wait for it. Tests
   about creating a block first wait for a listed row, then count creates
   rather than every request. */
const creates = () => apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");

/* Each records where focus was at every scroll, from the press on. */
function watchScrolls() {
  const focusAtScroll: (Element | null)[] = [];
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {
    focusAtScroll.push(document.activeElement);
  });
  onTestFinished(() => {
    scrolled.mockRestore();
  });
  return { scrolled, focusAtScroll };
}

describe("BlockAttachSheet", () => {
  it("is a modal: focus moves in and Escape closes", async () => {
    apiFetch.mockResolvedValue(page([]));
    const onClose = vi.fn();
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Add blocks" })).toHaveFocus();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  /* Each fakes only the debounce's timers. jsdom runs frames and its focus
     fixup on a setInterval (R-214): started under a fake clock, neither ran
     again for the rest of the file. */
  it("lists the registry at once on opening, without waiting out the typing debounce", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      apiFetch.mockResolvedValue(page([]));
      render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(apiFetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a pause in typing before searching", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      apiFetch.mockResolvedValue(page([]));
      render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      act(() => {
        fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "12" } });
      });
      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(apiFetch).toHaveBeenCalledOnce();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(apiFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists the registry", async () => {
    apiFetch.mockResolvedValue(page([block("b1", "123"), block("b2", "125")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("Blk 123")).toBeInTheDocument();
    expect(screen.getByText("Blk 125")).toBeInTheDocument();
  });

  it("leaves out the blocks already on the outing", async () => {
    // Offering an attached block would produce a no-op the admin cannot explain.
    apiFetch.mockResolvedValue(page([block("b1", "123"), block("b2", "125")]));
    render(<BlockAttachSheet attachedIds={["b1"]} onAttach={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("Blk 125")).toBeInTheDocument();
    expect(screen.queryByText("Blk 123")).not.toBeInTheDocument();
  });

  it("searches the registry by what was typed", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([block("b1", "123")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("Blk 123");

    await user.type(screen.getByLabelText("Search the block registry"), "125");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/blocks?limit=50&search=125");
    });
  });

  it("cannot attach until something is selected", async () => {
    apiFetch.mockResolvedValue(page([block("b1", "123")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("Blk 123");

    expect(screen.getByRole("button", { name: "Select a block" })).toBeDisabled();
  });

  it("attaches the blocks that were picked", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn().mockResolvedValue(undefined);
    apiFetch.mockResolvedValue(page([block("b1", "123"), block("b2", "125")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={onAttach} onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Blk 123/ }));
    await user.click(screen.getByRole("button", { name: /Blk 125/ }));
    await user.click(screen.getByRole("button", { name: "Attach 2 blocks" }));

    expect(onAttach).toHaveBeenCalledWith(["b1", "b2"]);
  });

  it("lets a selection be taken back", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([block("b1", "123")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);

    const row = await screen.findByRole("button", { name: /Blk 123/ });
    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "false");
  });

  it("registers a block that is not listed, and selects it", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn().mockResolvedValue(undefined);
    /* Routed by method, not blanket-mocked: the sheet is listing and creating
       against the same path, and conflating them hid a race once already. */
    apiFetch.mockImplementation((_path, init) =>
      init?.method === "POST"
        ? Promise.resolve(block("b9", "127"))
        : Promise.resolve(page([block("b1", "123")])),
    );
    render(<BlockAttachSheet attachedIds={[]} onAttach={onAttach} onClose={vi.fn()} />);
    await screen.findByText("Blk 123");

    await user.click(screen.getByRole("button", { name: "Block not listed?" }));
    await user.type(screen.getByLabelText("Block number"), "127");
    await user.type(screen.getByLabelText("Street"), "Test Ave");
    await user.click(screen.getByRole("button", { name: "Add to the registry" }));

    expect(await screen.findByRole("button", { name: "Attach 1 block" })).toBeEnabled();
    expect(screen.getByText("Blk 127")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Attach 1 block" }));
    expect(onAttach).toHaveBeenCalledWith(["b9"]);
  });

  it("keeps a block just registered when a slower listing comes back", async () => {
    // The bug CI caught: an in-flight search landing after the create wiped
    // the new block off the list.
    const user = userEvent.setup();
    let releaseList: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((_path, init) => {
      if (init?.method === "POST") return Promise.resolve(block("b9", "127"));
      return new Promise((resolve) => {
        releaseList = resolve;
      });
    });
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);

    // The listing has to be genuinely in flight, or there is no race to lose.
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/blocks?limit=50");
    });

    await user.click(screen.getByRole("button", { name: "Block not listed?" }));
    await user.type(screen.getByLabelText("Block number"), "127");
    await user.type(screen.getByLabelText("Street"), "Test Ave");
    await user.click(screen.getByRole("button", { name: "Add to the registry" }));
    await screen.findByText("Blk 127");

    /* act flushes the resolved promise and the render it would cause, so the
       assertion runs after the stale response has had its chance. */
    await act(async () => {
      releaseList(page([block("b1", "123")]));
      await Promise.resolve();
    });

    expect(screen.getByText("Blk 127")).toBeInTheDocument();
    expect(screen.queryByText("Blk 123")).not.toBeInTheDocument();
  });

  it("refuses a half-filled block before a round trip", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([block("b1", "123")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("Blk 123");

    await user.click(screen.getByRole("button", { name: "Block not listed?" }));
    await user.type(screen.getByLabelText("Block number"), "127");
    await user.click(screen.getByRole("button", { name: "Add to the registry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("number and a street");
    expect(creates()).toEqual([]);
  });

  it("reports a duplicate block from the server", async () => {
    const user = userEvent.setup();
    /* Only the create fails. A blanket rejection would also fail the listing,
       whose error reads the same, and the test would pass without a create. */
    apiFetch.mockImplementation((_path, init) =>
      init?.method === "POST"
        ? Promise.reject(
            new ApiRequestError(409, {
              error: {
                code: "conflict",
                message: "A block with that number and street already exists.",
              },
            }),
          )
        : Promise.resolve(page([block("b1", "125")])),
    );
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("Blk 125");

    await user.click(screen.getByRole("button", { name: "Block not listed?" }));
    await user.type(screen.getByLabelText("Block number"), "123");
    await user.type(screen.getByLabelText("Street"), "Test Ave");
    await user.click(screen.getByRole("button", { name: "Add to the registry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(creates()).toHaveLength(1);
  });

  it("ignores a failure from a listing that a newer search has overtaken", async () => {
    // The rows from a stale listing were already ignored; its error was not,
    // and put an alert over a list that had loaded fine.
    const user = userEvent.setup();
    let failOpening: (reason: Error) => void = () => undefined;
    const opening = new Promise<never>((_resolve, reject) => {
      failOpening = reject;
    });
    apiFetch.mockImplementation((path) =>
      path === "/blocks?limit=50" ? opening : Promise.resolve(page([block("b2", "125")])),
    );
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/blocks?limit=50");
    });

    await user.type(screen.getByLabelText("Search the block registry"), "125");
    await screen.findByText("Blk 125");

    /* The sheet's handler was attached to this promise before ours, so once
       ours has run, the sheet has had its chance to show the error. */
    await act(async () => {
      failOpening(new Error("Could not reach the server."));
      await opening.catch(() => undefined);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Blk 125")).toBeInTheDocument();
  });

  it("reports a failure to attach without closing", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn().mockRejectedValue(
      new ApiRequestError(409, {
        error: { code: "session_not_active", message: "That session has ended." },
      }),
    );
    apiFetch.mockResolvedValue(page([block("b1", "123")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={onAttach} onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Blk 123/ }));
    await user.click(screen.getByRole("button", { name: "Attach 1 block" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That session has ended.");
  });

  /* Disabled while their request is out, both lose focus to the page,
     outside the sheet (#221). Each holds the refusal until focus has
     dropped, as a real one is (D-208-6). */
  describe("focus after a refusal", () => {
    function held(): { promise: Promise<never>; refuse: (reason: unknown) => void } {
      let refuse: (reason: unknown) => void = () => undefined;
      const promise = new Promise<never>((_, reject) => {
        refuse = reject;
      });
      return { promise, refuse };
    }

    it("goes back to Attach, inside the sheet", async () => {
      const attach = held();
      const user = userEvent.setup();
      apiFetch.mockResolvedValue(page([block("b1", "123")]));
      render(
        <BlockAttachSheet attachedIds={[]} onAttach={() => attach.promise} onClose={vi.fn()} />,
      );
      const dialog = screen.getByRole("dialog", { name: "Add blocks" });
      await user.click(await screen.findByRole("button", { name: /Blk 123/ }));
      const button = screen.getByRole("button", { name: "Attach 1 block" });
      await pressByKey(user, button);
      expect(button).toBeDisabled();
      await focusDropped();

      const { scrolled, focusAtScroll } = watchScrolls();
      attach.refuse(new TypeError("Failed to fetch"));
      const alert = await screen.findByRole("alert");
      expect(button).toHaveFocus();
      expect(dialog).toContainElement(button);
      expect(alert).not.toHaveFocus();
      // Back on Attach before the failure is brought into view (D-208-4).
      expect(scrolled.mock.contexts).toEqual([alert]);
      expect(focusAtScroll).toEqual([button]);
    });

    it("goes back to Add to the registry", async () => {
      const create = held();
      const user = userEvent.setup();
      apiFetch.mockImplementation((_path, init) =>
        init?.method === "POST" ? create.promise : Promise.resolve(page([block("b1", "125")])),
      );
      render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
      await screen.findByText("Blk 125");
      await user.click(screen.getByRole("button", { name: "Block not listed?" }));
      await user.type(screen.getByLabelText("Block number"), "123");
      await user.type(screen.getByLabelText("Street"), "Test Ave");
      const button = screen.getByRole("button", { name: "Add to the registry" });
      await pressByKey(user, button);
      await screen.findByRole("button", { name: "Adding…" });
      await focusDropped();

      const { scrolled, focusAtScroll } = watchScrolls();
      create.refuse(new TypeError("Failed to fetch"));
      const alert = await screen.findByRole("alert");
      expect(button).toHaveFocus();
      /* The failure comes last, after the sheet brings the button it gave
         focus back to into view, so it is what ends in view. */
      expect(scrolled.mock.contexts.at(-1)).toBe(alert);
      expect(focusAtScroll.at(-1)).toBe(button);
    });
  });

  /* Said atop the sheet, a failed press was above the view once the list
     or the new block's fields were scrolled past: Add to the registry at
     every text size, Attach at the largest (#232). */
  describe("a failed press, said beside the actions", () => {
    it("says a failed Attach just above its bar, and brings it into view as it is drawn", async () => {
      const user = userEvent.setup();
      apiFetch.mockResolvedValue(page([block("b1", "123")]));
      const onAttach = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      render(<BlockAttachSheet attachedIds={[]} onAttach={onAttach} onClose={vi.fn()} />);
      await user.click(await screen.findByRole("button", { name: /Blk 123/ }));
      const attach = screen.getByRole("button", { name: "Attach 1 block" });
      attach.focus();
      const { scrolled } = watchScrolls();
      await user.keyboard("{Enter}");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Could not attach those blocks.");
      const bar = alert.nextElementSibling;
      expect(bar).toHaveAttribute("data-sheet-actions");
      expect(bar).toContainElement(attach);
      expect(scrolled.mock.contexts).toEqual([alert]);
      expect(scrolled.mock.calls).toEqual([[{ block: "nearest" }]]);
      expect(alert).not.toHaveFocus();
    });

    it("says a refused Add to the registry under it, and brings it into view", async () => {
      const user = userEvent.setup();
      apiFetch.mockResolvedValue(page([block("b1", "125")]));
      render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
      await screen.findByText("Blk 125");
      await user.click(screen.getByRole("button", { name: "Block not listed?" }));
      await user.type(screen.getByLabelText("Block number"), "127");
      const add = screen.getByRole("button", { name: "Add to the registry" });
      add.focus();
      const { scrolled } = watchScrolls();
      await user.keyboard("{Enter}");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("number and a street");
      expect(add.compareDocumentPosition(alert)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(alert.nextElementSibling).toHaveAttribute("data-sheet-actions");
      expect(scrolled.mock.contexts).toEqual([alert]);
    });

    /* The sheet opens at its top (D-119-21), and a search is typed there. */
    it("says a listing that failed by the search, and scrolls nothing", async () => {
      const { scrolled } = watchScrolls();
      apiFetch.mockRejectedValue(new TypeError("Load failed"));
      render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Could not load the blocks.");
      expect(
        alert.compareDocumentPosition(screen.getByLabelText("Search the block registry")),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(scrolled).not.toHaveBeenCalled();
    });
  });

  it("reports a registry that will not load in its own words, not the browser's (#194)", async () => {
    apiFetch.mockRejectedValue(new TypeError("Load failed"));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the blocks.");
  });

  it("copes with non-Error failures", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the blocks.");
  });

  it("closes from the backdrop and from Cancel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    apiFetch.mockResolvedValue(page([]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
