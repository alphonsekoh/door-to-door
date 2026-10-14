import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockAttachSheet } from "@/components/block-attach-sheet";
import type { Block } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

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

/* The sheet lists the registry on a 200ms debounce after it opens, so that
   listing can land at any point in a test that does not wait for it. Tests
   about creating a block first wait for a listed row, then count creates
   rather than every request. */
const creates = () => apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");

describe("BlockAttachSheet", () => {
  it("is a modal: focus moves in and Escape closes", async () => {
    apiFetch.mockResolvedValue(page([]));
    const onClose = vi.fn();
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Add blocks" })).toHaveFocus();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
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
        ? Promise.reject(new Error("A block with that number and street already exists."))
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
    const onAttach = vi.fn().mockRejectedValue(new Error("That session has ended."));
    apiFetch.mockResolvedValue(page([block("b1", "123")]));
    render(<BlockAttachSheet attachedIds={[]} onAttach={onAttach} onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Blk 123/ }));
    await user.click(screen.getByRole("button", { name: "Attach 1 block" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That session has ended.");
  });

  it("reports a registry that will not load", async () => {
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<BlockAttachSheet attachedIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
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
