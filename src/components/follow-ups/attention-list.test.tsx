import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import {
  AttentionList,
  daysSince,
  sinceLabel,
  whyHere,
} from "@/components/follow-ups/attention-list";
import type { HouseholdAttention, InterestLevel } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

/* A door's label, drawn in pieces so its unit number never breaks: the
   innermost element holding the whole of it. */
const door = (label: string) => (_: string, element: Element | null) =>
  element?.textContent === label &&
  ![...element.children].some((child) => child.textContent === label);

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

/* The address as Next's router last read it; a test says when that moves.
   No useRouter: a router navigation waits on the server (useAddressFilters). */
const { searchParams } = vi.hoisted(() => ({
  searchParams: { value: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.value,
}));

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

const AT = "2026-03-14T11:00:00.000Z";

const BLOCK_A = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5a";
const BLOCK_B = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function row(
  unitNumber: string,
  options: {
    name?: string | null;
    contact?: string | null;
    interestLevel?: InterestLevel;
    lastVisitedAt?: string;
    description?: string;
  } = {},
): HouseholdAttention {
  const {
    name = null,
    contact = null,
    interestLevel = "high",
    lastVisitedAt = AT,
    description = "",
  } = options;
  return {
    household: {
      id: `h-${unitNumber}`,
      blockId: "b1",
      unitNumber,
      name,
      contact,
      religion: null,
      createdAt: AT,
      updatedAt: AT,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
    latestVisit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId: "s1",
      member: { id: "u1", name: "Alice", image: null },
      team: null,
      interestLevel,
      description,
      clientCreatedAt: lastVisitedAt,
      createdAt: lastVisitedAt,
      updatedAt: lastVisitedAt,
    },
    visitCount: 1,
    lastVisitedAt,
  };
}

const page = (rows: HouseholdAttention[], total = rows.length) => ({
  data: rows,
  pagination: { limit: 50, offset: 0, total, hasMore: rows.length < total },
});

const BLOCKS = {
  data: [
    { id: BLOCK_A, name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
    { id: BLOCK_B, name: "125", street: "Test Ave", postalCode: null, createdAt: AT },
  ],
  pagination: { limit: 100, offset: 0, total: 2, hasMore: false },
};

/* The block picker, the follow-up sheet's look for a session to offer and
   its save, and the list itself, answered from the request's query. */
function serve(list: (query: URLSearchParams) => unknown, onAdd: () => void = () => undefined) {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      onAdd();
      return Promise.resolve({});
    }
    if (path === "/blocks?limit=100") return Promise.resolve(BLOCKS);
    if (path.startsWith("/sessions?")) return Promise.resolve({ data: [] });
    const [where = "", query = ""] = path.split("?");
    if (where !== "/households/attention") return Promise.reject(new Error(`unexpected ${path}`));
    return Promise.resolve(list(new URLSearchParams(query)));
  });
}

const serveRows = (rows: HouseholdAttention[], total = rows.length) => {
  serve(() => page(rows, total));
};

/* A request held until the test lets it answer or fail. */
function held() {
  let settle: { answer: (value: unknown) => void; refuse: (reason: unknown) => void } = {
    answer: () => undefined,
    refuse: () => undefined,
  };
  const promise = new Promise((answer, refuse) => {
    settle = { answer, refuse };
  });
  /* A macrotask after it, so whatever the screen does with the page has
     happened by the time the test looks. */
  const then = async (run: () => void) => {
    await act(async () => {
      run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return {
    promise,
    answer: (value: unknown) =>
      then(() => {
        settle.answer(value);
      }),
    refuse: (reason: unknown) =>
      then(() => {
        settle.refuse(reason);
      }),
  };
}

/* Next's patched replaceState hands the new address to useSearchParams; here
   the test does, and the screen reads it back. */
function follow(rerender: (ui: ReactElement) => void) {
  searchParams.value = new URLSearchParams(window.location.search);
  rerender(<AttentionList />);
}

const address = () => `${window.location.pathname}${window.location.search}`;

const listRequests = () =>
  apiFetch.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith("/households/attention"));

const doors = () =>
  screen.getAllByRole("link").map((link) => /#\d\d-\d+/.exec(link.textContent)?.[0]);

const searchBox = () => screen.getByLabelText("Search by unit, name or contact");
const blockPicker = () => screen.getByLabelText("Filter by block");

async function blocksListed(): Promise<void> {
  await waitFor(() => {
    expect(within(blockPicker()).getByRole("option", { name: "Blk 125" })).toBeInTheDocument();
  });
}

/* What Next's router keeps in the history entry. */
const NEXT = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "t" } };

let replaceState: MockInstance<History["replaceState"]>;

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
  window.history.replaceState(NEXT, "", "/admin/attention");
  replaceState = vi.spyOn(window.history, "replaceState");
  useRole.mockReturnValue({ userId: "a1", isAdmin: true });
  useOnline.mockReturnValue(true);
});

afterEach(() => {
  replaceState.mockRestore();
});

describe("daysSince", () => {
  it("counts whole days", () => {
    const now = new Date("2026-03-14T11:00:00.000Z");
    expect(daysSince("2026-03-11T11:00:00.000Z", now)).toBe(3);
  });

  it("rounds down, so most of a day is not yet a day", () => {
    const now = new Date("2026-03-14T11:00:00.000Z");
    expect(daysSince("2026-03-13T12:00:00.000Z", now)).toBe(0);
  });
});

describe("sinceLabel", () => {
  it.each([
    [0, "today"],
    [1, "yesterday"],
    [3, "3 days ago"],
    [60, "60 days ago"],
    [90, "3 months ago"],
  ])("reads %s days as %s", (days, label) => {
    expect(sinceLabel(days)).toBe(label);
  });

  it("treats a visit dated in the future as today rather than negative", () => {
    // A device with a wrong clock can queue a visit stamped ahead of now.
    expect(sinceLabel(-2)).toBe("today");
  });
});

describe("AttentionList", () => {
  it("lists the doors that showed interest and were left", async () => {
    serveRows([row("#05-123", { name: "Mr Tan" })]);
    render(<AttentionList />);

    expect(await screen.findByText(door("Blk 123, #05-123"))).toBeInTheDocument();
    expect(screen.getByText(/Mr Tan/)).toBeInTheDocument();
  });

  it("asks for the first page, high interest only, in every block by default", async () => {
    serveRows([]);
    render(<AttentionList />);

    await waitFor(() => {
      expect(listRequests()).toEqual(["/households/attention?limit=50&offset=0"]);
    });
  });

  it("says how long the door has been waiting", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    serveRows([row("#05-123", { lastVisitedAt: threeDaysAgo })]);
    render(<AttentionList />);

    expect(await screen.findByText(/last visited 3 days ago/)).toBeInTheDocument();
  });

  it("shows the interest level in words", async () => {
    serveRows([row("#05-123", { interestLevel: "medium" })]);
    render(<AttentionList />);
    expect(await screen.findByText("Medium")).toBeInTheDocument();
  });

  it("carries the note from the visit that put it on the list", async () => {
    serveRows([row("#05-123", { description: "Asked for a Bible" })]);
    render(<AttentionList />);
    expect(await screen.findByText("Asked for a Bible")).toBeInTheDocument();
  });

  it("links to the unit's full timeline", async () => {
    serveRows([row("#05-123")]);
    render(<AttentionList />);

    expect(await screen.findByRole("link", { name: /#05-123/ })).toHaveAttribute(
      "href",
      "/households/h-#05-123",
    );
  });

  it("offers a retry when the list fails to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AttentionList />);

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the list.");

    serveRows([row("#05-123")]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(door("Blk 123, #05-123"))).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AttentionList />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the list.");
  });
});

describe("filtering by block and interest", () => {
  it("offers every block, after All blocks", async () => {
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));
    await blocksListed();

    expect(
      within(blockPicker())
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All blocks", "Blk 123", "Blk 125"]);
  });

  it("reads the block and the medium toggle from the address and sends both", async () => {
    searchParams.value = new URLSearchParams(`blockId=${BLOCK_B}&minimumInterest=medium`);
    serveRows([row("#07-07")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #07-07"));

    expect(listRequests()).toEqual([
      `/households/attention?limit=50&offset=0&minimumInterest=medium&blockId=${BLOCK_B}`,
    ]);
    expect(screen.getByRole("button", { name: "High interest only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await blocksListed();
    expect(blockPicker()).toHaveValue(BLOCK_B);
  });

  it("never sends a block id that is not one, which the API would refuse", async () => {
    searchParams.value = new URLSearchParams("blockId=125");
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));

    expect(listRequests()).toEqual(["/households/attention?limit=50&offset=0"]);
  });

  it("writes the block to the address and keeps the toggle", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("minimumInterest=medium");
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));
    await blocksListed();

    await user.selectOptions(blockPicker(), BLOCK_B);
    expect(address()).toBe(`/admin/attention?blockId=${BLOCK_B}&minimumInterest=medium`);
  });

  it("goes back to every block", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams(`blockId=${BLOCK_B}`);
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));
    await blocksListed();

    await user.selectOptions(blockPicker(), "");
    expect(address()).toBe("/admin/attention");
  });

  it("writes the toggle to the address and keeps the block", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams(`blockId=${BLOCK_B}`);
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));

    const toggle = screen.getByRole("button", { name: "Include medium interest" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(address()).toBe(`/admin/attention?blockId=${BLOCK_B}&minimumInterest=medium`);
  });

  it("narrows back to high interest", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("minimumInterest=medium");
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));

    await user.click(screen.getByRole("button", { name: "High interest only" }));
    expect(address()).toBe("/admin/attention");
  });

  it.each([
    [
      "a block",
      () => userEvent.selectOptions(blockPicker(), BLOCK_B),
      `/admin/attention?blockId=${BLOCK_B}`,
    ],
    [
      "the toggle",
      () => userEvent.click(screen.getByRole("button", { name: "Include medium interest" })),
      "/admin/attention?minimumInterest=medium",
    ],
  ])(
    "moves the address itself for %s, handing it to Next with no state",
    async (_, change, href) => {
      // Not router.replace, which waits on the server: the controls would show
      // the filter just left until it answered, and offline the screen would
      // become Offline. Given Next's own state, its patch would not tell
      // useSearchParams.
      serveRows([row("#05-123")]);
      render(<AttentionList />);
      await screen.findByText(door("Blk 123, #05-123"));
      await blocksListed();
      replaceState.mockClear();

      await change();

      expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", href);
      expect(address()).toBe(href);
    },
  );

  it("shows each change at once and keeps it through the next, before the router reports either", async () => {
    // Read from the router's copy, a second change made before it caught up
    // was built on the first's old value and dropped it.
    const user = userEvent.setup();
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));
    await blocksListed();

    await user.click(screen.getByRole("button", { name: "Include medium interest" }));
    await user.selectOptions(blockPicker(), BLOCK_B);

    expect(screen.getByRole("button", { name: "High interest only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(blockPicker()).toHaveValue(BLOCK_B);
    expect(address()).toBe(`/admin/attention?blockId=${BLOCK_B}&minimumInterest=medium`);
    await waitFor(() => {
      expect(listRequests()).toContain(
        `/households/attention?limit=50&offset=0&minimumInterest=medium&blockId=${BLOCK_B}`,
      );
    });
  });

  it("keeps the rows and the picker's focus while the block's doors load, and reads the blocks once", async () => {
    // Swapped for "Loading…", the picker would leave the page mid-choice.
    const user = userEvent.setup();
    const blockB = held();
    serve((query) =>
      query.get("blockId") === BLOCK_B ? blockB.promise : page([row("#05-123")], 2),
    );
    const { rerender } = render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-123"));
    await blocksListed();

    await user.selectOptions(blockPicker(), BLOCK_B);
    follow(rerender);
    await waitFor(() => {
      expect(listRequests()).toContain(
        `/households/attention?limit=50&offset=0&blockId=${BLOCK_B}`,
      );
    });

    expect(screen.getByText(door("Blk 123, #05-123"))).toBeInTheDocument();
    expect(blockPicker()).toHaveFocus();
    // Pressed now, it would ask for the next page of rows about to go.
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    await blockB.answer(page([row("#07-07")]));
    expect(await screen.findByText(door("Blk 123, #07-07"))).toBeInTheDocument();
    expect(screen.queryByText(door("Blk 123, #05-123"))).not.toBeInTheDocument();
    expect(blockPicker()).toHaveFocus();
    expect(apiFetch.mock.calls.filter(([path]) => String(path).startsWith("/blocks"))).toHaveLength(
      1,
    );
  });

  it("still lists the doors when the blocks cannot be read", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/blocks")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(page([row("#05-123")])),
    );
    render(<AttentionList />);

    expect(await screen.findByText(door("Blk 123, #05-123"))).toBeInTheDocument();
    expect(within(blockPicker()).getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never lets a page for the filters just left land under the new ones", async () => {
    const everyBlock = held();
    serve((query) =>
      query.get("blockId") === BLOCK_B ? page([row("#07-07")]) : everyBlock.promise,
    );
    const { rerender } = render(<AttentionList />);
    await waitFor(() => {
      expect(listRequests()).toHaveLength(1);
    });

    searchParams.value = new URLSearchParams(`blockId=${BLOCK_B}`);
    rerender(<AttentionList />);
    expect(await screen.findByText(door("Blk 123, #07-07"))).toBeInTheDocument();

    await everyBlock.answer(page([row("#01-01")]));
    expect(screen.getByText(door("Blk 123, #07-07"))).toBeInTheDocument();
    expect(screen.queryByText(door("Blk 123, #01-01"))).not.toBeInTheDocument();
  });

  it("never lets a failure for the filters just left replace the new ones' doors", async () => {
    const everyBlock = held();
    serve((query) =>
      query.get("blockId") === BLOCK_B ? page([row("#07-07")]) : everyBlock.promise,
    );
    const { rerender } = render(<AttentionList />);
    await waitFor(() => {
      expect(listRequests()).toHaveLength(1);
    });

    searchParams.value = new URLSearchParams(`blockId=${BLOCK_B}`);
    rerender(<AttentionList />);
    expect(await screen.findByText(door("Blk 123, #07-07"))).toBeInTheDocument();

    await everyBlock.refuse(new TypeError("Failed to fetch"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(door("Blk 123, #07-07"))).toBeInTheDocument();
  });

  it("never adds a Show more page to a block chosen while it was out", async () => {
    const user = userEvent.setup();
    const next = held();
    serve((query) => {
      if (query.get("blockId") === BLOCK_B) return page([row("#07-07")]);
      return query.get("offset") === "0" ? page([row("#01-01")], 2) : next.promise;
    });
    const { rerender } = render(<AttentionList />);
    await screen.findByText(door("Blk 123, #01-01"));
    await blocksListed();

    await user.click(screen.getByRole("button", { name: "Show more (1 of 2)" }));
    await user.selectOptions(blockPicker(), BLOCK_B);
    follow(rerender);
    expect(await screen.findByText(door("Blk 123, #07-07"))).toBeInTheDocument();

    await next.answer(page([row("#01-02")], 2));
    expect(doors()).toEqual(["#07-07"]);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
  });
});

describe("searching by unit, name or contact", () => {
  it("searches the loaded doors by unit, name or contact, in the server's order, asking nothing and writing nothing", async () => {
    // The term is a name or a phone number: in a request or the address it
    // would reach the server's logs and the phone's history (D-129-7).
    const user = userEvent.setup();
    serveRows([
      row("#09-56", { contact: "91234567" }),
      row("#05-12", { name: "Mr Tan" }),
      row("#07-34", { name: "Mdm Lim" }),
    ]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-12"));
    apiFetch.mockClear();

    await user.type(searchBox(), "0734");
    expect(doors()).toEqual(["#07-34"]);

    await user.clear(searchBox());
    await user.type(searchBox(), "#05-1");
    expect(doors()).toEqual(["#05-12"]);

    await user.clear(searchBox());
    await user.type(searchBox(), "TAN");
    expect(doors()).toEqual(["#05-12"]);

    await user.clear(searchBox());
    await user.type(searchBox(), "9123");
    expect(doors()).toEqual(["#09-56"]);

    await user.clear(searchBox());
    await user.type(searchBox(), "0");
    expect(doors()).toEqual(["#09-56", "#05-12", "#07-34"]);

    // Let any deferred load run: typing must not start one.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(address()).toBe("/admin/attention");
  });

  it("keeps the search through a block change and searches the block's doors", async () => {
    const user = userEvent.setup();
    serve((query) =>
      query.get("blockId") === BLOCK_A
        ? page([row("#01-01", { name: "Mr Tan" }), row("#01-02", { name: "Mdm Lim" })])
        : page([row("#05-12", { name: "Mrs Tan" }), row("#07-34")]),
    );
    const { rerender } = render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-12"));
    await blocksListed();
    await user.type(searchBox(), "tan");

    await user.selectOptions(blockPicker(), BLOCK_A);
    // Nor is the term written along with the block.
    expect(address()).toBe(`/admin/attention?blockId=${BLOCK_A}`);
    follow(rerender);

    expect(await screen.findByText(door("Blk 123, #01-01"))).toBeInTheDocument();
    expect(doors()).toEqual(["#01-01"]);
    expect(searchBox()).toHaveValue("tan");
    expect(listRequests().filter((path) => /q=|tan/i.test(path))).toEqual([]);
  });

  it("moves an old link's search term from the address into the search (#163)", async () => {
    const link = "/admin/attention?q=Tan&minimumInterest=medium";
    window.history.replaceState(null, "", link);
    searchParams.value = new URL(link, window.location.href).searchParams;
    serveRows([row("#05-12", { name: "Mr Tan" }), row("#07-34", { name: "Mdm Lim" })]);
    render(<AttentionList />);

    expect(await screen.findByText(door("Blk 123, #05-12"))).toBeInTheDocument();
    expect(doors()).toEqual(["#05-12"]);
    expect(searchBox()).toHaveValue("Tan");
    expect(address()).toBe("/admin/attention?minimumInterest=medium");
    expect(listRequests()).toEqual([
      "/households/attention?limit=50&offset=0&minimumInterest=medium",
    ]);
  });
});

describe("clearing the filters", () => {
  it.each(["", "minimumInterest=medium"])(
    "is not offered with nothing narrowing the list (%j)",
    async (query) => {
      // The toggle widens the list, so there is nothing to clear.
      searchParams.value = new URLSearchParams(query);
      serveRows([row("#05-12")]);
      render(<AttentionList />);
      await screen.findByText(door("Blk 123, #05-12"));

      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    },
  );

  it("empties a search without touching the address", async () => {
    const user = userEvent.setup();
    serveRows([row("#05-12"), row("#07-34")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-12"));
    await user.type(searchBox(), "0734");
    expect(doors()).toEqual(["#07-34"]);

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(searchBox()).toHaveValue("");
    expect(doors()).toEqual(["#05-12", "#07-34"]);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("clears the block and the search, and keeps the toggle", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams(`blockId=${BLOCK_B}&minimumInterest=medium`);
    serveRows([row("#05-12"), row("#07-34")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-12"));
    await user.type(searchBox(), "0734");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(address()).toBe("/admin/attention?minimumInterest=medium");
    expect(searchBox()).toHaveValue("");
  });
});

describe("an empty list", () => {
  it.each(["", "minimumInterest=medium"])(
    "reads as good news when nothing is waiting (%j)",
    async (query) => {
      searchParams.value = new URLSearchParams(query);
      serveRows([]);
      render(<AttentionList />);
      expect(await screen.findByText("Nothing is waiting.")).toBeInTheDocument();
    },
  );

  it("says the block matches nothing, not that nothing is waiting", async () => {
    // An empty block says nothing about the doors in the others.
    searchParams.value = new URLSearchParams(`blockId=${BLOCK_B}`);
    serveRows([]);
    render(<AttentionList />);

    expect(await screen.findByText("Nothing here matches those filters.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is waiting.")).not.toBeInTheDocument();
  });

  it("says the search matches nothing when it excludes every loaded door", async () => {
    const user = userEvent.setup();
    serveRows([row("#05-12")]);
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-12"));

    await user.type(searchBox(), "zzz");
    expect(screen.getByText("Nothing here matches those filters.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is waiting.")).not.toBeInTheDocument();
  });
});

describe("Show more", () => {
  const first = Array.from({ length: 50 }, (_, i) =>
    row(`#01-${String(i).padStart(2, "0")}`, { name: "Mr Lim" }),
  );

  it("adds the next page, for the same filters, to the end of the list", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams(`blockId=${BLOCK_A}&minimumInterest=medium`);
    const next = held();
    serve((query) => (query.get("offset") === "0" ? page(first, 51) : next.promise));
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #01-00"));

    await user.click(screen.getByRole("button", { name: "Show more (50 of 51)" }));
    expect(listRequests().at(-1)).toBe(
      `/households/attention?limit=50&offset=50&minimumInterest=medium&blockId=${BLOCK_A}`,
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    await next.answer(page([row("#09-99")], 51));
    expect(await screen.findByText(door("Blk 123, #09-99"))).toBeInTheDocument();
    expect(doors()).toHaveLength(51);
    expect(doors().at(0)).toBe("#01-00");
    expect(doors().at(-1)).toBe("#09-99");
    // Everything is loaded.
    expect(screen.queryByRole("button", { name: /Show more|Loading/ })).not.toBeInTheDocument();
  });

  it("is how a search reaches past the first page", async () => {
    const user = userEvent.setup();
    serve((query) =>
      query.get("offset") === "0" ? page(first, 51) : page([row("#09-99", { name: "Mr Tan" })], 51),
    );
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #01-00"));
    await user.type(searchBox(), "tan");
    expect(screen.getByText("Nothing here matches those filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show more (50 of 51)" }));

    expect(await screen.findByText(door("Blk 123, #09-99"))).toBeInTheDocument();
    expect(doors()).toEqual(["#09-99"]);
  });

  it("replaces the list with its failure and a retry from the top when a page fails", async () => {
    const user = userEvent.setup();
    serve((query) =>
      query.get("offset") === "0"
        ? page([row("#05-12")], 2)
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-12"));

    await user.click(screen.getByRole("button", { name: "Show more (1 of 2)" }));
    expect(listRequests().at(-1)).toBe("/households/attention?limit=50&offset=1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the list.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(door("Blk 123, #05-12"))).toBeInTheDocument();
    expect(listRequests().at(-1)).toBe("/households/attention?limit=50&offset=0");
  });
});

describe("adding a door to the follow-up list", () => {
  it("says why the door is here", () => {
    expect(whyHere(row("#05-123", { lastVisitedAt: new Date(2026, 2, 3, 12).toISOString() }))).toBe(
      "Showed high interest on 3 Mar 2026.",
    );
    expect(
      whyHere(
        row("#05-123", {
          interestLevel: "medium",
          lastVisitedAt: new Date(2026, 2, 3, 12).toISOString(),
        }),
      ),
    ).toBe("Showed medium interest on 3 Mar 2026.");
  });

  it("adds a row's household, anchored to its latest visit, then re-reads the list", async () => {
    const user = userEvent.setup();
    let added = false;
    serve(
      () => page(added ? [] : [row("#05-123")]),
      () => {
        added = true;
      },
    );
    render(<AttentionList />);
    await user.click(await screen.findByRole("button", { name: "Add to list" }));

    const sheet = within(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    );
    // Why it is here is said, not saved as what the next visit should do.
    expect(sheet.getByText(whyHere(row("#05-123")))).toBeVisible();
    expect(sheet.getByLabelText("What should the next visit do?")).toHaveValue("");
    await user.type(sheet.getByLabelText("What should the next visit do?"), "Bring the booklet");
    const add = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    await user.click(add);

    expect(await screen.findByRole("status")).toHaveTextContent("Added to the follow-up list.");
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
      method: "POST",
      body: JSON.stringify({
        householdId: "h-#05-123",
        visitId: "v-#05-123",
        note: "Bring the booklet",
        dueDate: null,
      }),
    });
    // Listed now, so it has left this list.
    expect(await screen.findByText("Nothing is waiting.")).toBeInTheDocument();
  });

  it("re-reads from the top with the search kept", async () => {
    const user = userEvent.setup();
    let added = false;
    serve(
      () =>
        page([
          ...(added ? [] : [row("#05-12", { name: "Mr Tan" })]),
          row("#05-13", { name: "Mrs Tan" }),
          row("#07-34", { name: "Mdm Lim" }),
        ]),
      () => {
        added = true;
      },
    );
    render(<AttentionList />);
    await screen.findByText(door("Blk 123, #05-12"));
    await user.type(searchBox(), "tan");
    expect(doors()).toEqual(["#05-12", "#05-13"]);

    const [first] = screen.getAllByRole("button", { name: "Add to list" });
    if (!first) throw new Error("no Add to list");
    await user.click(first);
    const sheet = within(screen.getByRole("dialog", { name: "Add to the follow-up list, #05-12" }));
    await user.type(sheet.getByLabelText("What should the next visit do?"), "Bring the booklet");
    const add = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    await user.click(add);

    expect(await screen.findByRole("status")).toHaveTextContent("Added to the follow-up list.");
    await waitFor(() => {
      expect(doors()).toEqual(["#05-13"]);
    });
    expect(searchBox()).toHaveValue("tan");
    expect(listRequests().at(-1)).toBe("/households/attention?limit=50&offset=0");
  });

  it("puts the action beside the row, never inside its link", async () => {
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    const button = await screen.findByRole("button", { name: "Add to list" });
    expect(button.closest("a")).toBeNull();
  });

  it("closes without a request on Cancel", async () => {
    const user = userEvent.setup();
    serveRows([row("#05-123")]);
    render(<AttentionList />);
    await user.click(await screen.findByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(apiFetch).not.toHaveBeenCalledWith("/follow-ups", expect.anything());
  });
});
