import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsolidatedHistory } from "@/components/history/consolidated-history";
import type { HistoryEntry, InterestLevel } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { focusDropped, pressByKey } from "../../../test/focus-dropped";

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

/* The router's copy of the address. A test moves it only where the router
   would: on a link, Back or Forward. Next reports the screen's own writes
   back a render later, and router.replace did not until the server answered,
   so here it never does, and the screen must not need it. */
const { searchParams } = vi.hoisted(() => ({ searchParams: { value: new URLSearchParams() } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.value,
}));

function at(query: string) {
  searchParams.value = new URLSearchParams(query);
  window.history.replaceState(
    null,
    "",
    query === "" ? "/admin/history" : `/admin/history?${query}`,
  );
}

const address = () => `${window.location.pathname}${window.location.search}`;

vi.mock("@/lib/hooks/use-role", () => ({
  useRole: () => ({
    userId: "admin",
    role: "admin",
    isAdmin: true,
    isMember: false,
    isLoading: false,
    isSignedIn: true,
  }),
}));

const AT = "2026-03-14T11:00:00.000Z";

function entry(
  householdId: string,
  options: {
    unitNumber?: string;
    createdAt?: string;
    interestLevel?: InterestLevel;
    sessionTitle?: string;
    description?: string;
    team?: HistoryEntry["visit"]["team"];
  } = {},
): HistoryEntry {
  const {
    unitNumber = "#05-123",
    createdAt = AT,
    interestLevel = "low",
    sessionTitle = "March outing",
    description = "",
    team = null,
  } = options;
  return {
    visit: {
      id: `v-${householdId}-${createdAt}`,
      householdId,
      sessionId: "s1",
      member: { id: "u1", name: "Alice", image: null },
      team,
      interestLevel,
      description,
      clientCreatedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    },
    household: {
      id: householdId,
      blockId: "b1",
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt,
      updatedAt: createdAt,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt },
    session: {
      id: "s1",
      title: sessionTitle,
      kind: "regular",
      status: "ended",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt,
    },
  };
}

/* The outing picker holds the same titles as the rows, so assertions about a
   door are scoped to that door's card. */
async function card(unit: string): Promise<HTMLElement> {
  const heading = await screen.findByText(door(unit));
  const row = heading.closest("li");
  if (!row) throw new Error(`no card for ${unit}`);
  return row;
}

const pickers = {
  blocks: {
    data: [{ id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT }],
    pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
  },
  sessions: {
    data: [
      {
        id: "s1",
        title: "March outing",
        status: "ended",
        startedAt: null,
        endedAt: null,
        createdBy: { id: "admin", name: "Admin", image: null },
        createdAt: AT,
      },
    ],
    pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
  },
  users: {
    data: [
      {
        id: "u1",
        email: "alice@t.local",
        name: "Alice",
        image: null,
        role: "member",
        deactivatedAt: null,
        createdAt: AT,
      },
    ],
    pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
  },
};

const TEAM_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const teamsOf = (sessionId: string, name: string) => ({
  data: [{ id: TEAM_ID, sessionId, name, members: [], createdAt: AT }],
});

function serve(entries: HistoryEntry[], total = entries.length) {
  apiFetch.mockImplementation((path: string) => {
    if (path === "/sessions/s1/teams") return Promise.resolve(teamsOf("s1", "Alice & Ben"));
    if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
    if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
    if (path.startsWith("/users")) return Promise.resolve(pickers.users);
    return Promise.resolve({
      data: entries,
      pagination: { limit: 100, offset: 0, total, hasMore: entries.length < total },
    });
  });
}

const list = (entries: HistoryEntry[], total = entries.length) => ({
  data: entries,
  pagination: { limit: 100, offset: 0, total, hasMore: entries.length < total },
});

type Held = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

/* The pickers answer at once; each records request waits, keyed by `key`,
   for the test to settle it, in whatever order it likes. */
function holdHistory(key: (path: string) => string | null) {
  const held = new Map<string | null, Held>();
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
    if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
    if (path.startsWith("/users")) return Promise.resolve(pickers.users);
    return new Promise((resolve, reject) => {
      held.set(key(path), { resolve, reject });
    });
  });
  async function waiting(name: string | null): Promise<Held> {
    let found: Held | undefined;
    await waitFor(() => {
      found = held.get(name);
      expect(found, `a request for ${String(name)}`).toBeDefined();
    });
    if (found === undefined) throw new Error(`no request for ${String(name)}`);
    return found;
  }
  return {
    waiting,
    async answer(name: string | null, value: unknown) {
      const request = await waiting(name);
      await act(async () => {
        request.resolve(value);
        await Promise.resolve();
      });
    },
  };
}

let csv = "";

beforeEach(() => {
  vi.clearAllMocks();
  at("");
  csv = "";
  /* jsdom has no object URLs and cannot follow a download, so the blob is
     captured here instead - which is also the only way to assert its contents. */
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:stub");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "Blob").mockImplementation(function MockBlob(parts: BlobPart[]) {
    csv = parts.map(String).join("");
    return { size: csv.length, type: "text/csv" } as unknown as Blob;
  } as unknown as typeof Blob);
});

describe("ConsolidatedHistory", () => {
  it("puts every visit to one door on one row", async () => {
    // The consolidated timeline: March and August are one unit, not two rows.
    serve([
      entry("h1", { createdAt: "2026-03-01T10:00:00.000Z", interestLevel: "low" }),
      entry("h1", {
        createdAt: "2026-08-01T10:00:00.000Z",
        interestLevel: "high",
        sessionTitle: "August outing",
      }),
    ]);
    render(<ConsolidatedHistory />);

    const row = await card("Blk 123, #05-123");
    expect(within(row).getByText("2 visits")).toBeInTheDocument();
    expect(within(row).getByText(/March outing/)).toBeInTheDocument();
    expect(within(row).getByText(/August outing/)).toBeInTheDocument();
  });

  it("asks for the first page with no filters by default", async () => {
    serve([]);
    render(<ConsolidatedHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/history?limit=100&offset=0");
    });
  });

  it("reads its filters from the URL", async () => {
    at("religion=buddhist&from=2026-03-01");
    serve([]);
    render(<ConsolidatedHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/history?limit=100&offset=0&religion=buddhist&from=2026-03-01T00%3A00%3A00.000Z",
      );
    });
  });

  it("writes each filter back to the URL", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    await user.selectOptions(screen.getByLabelText("Filter by religion"), "hindu");
    expect(address()).toBe("/admin/history?religion=hindu");

    await user.selectOptions(screen.getByLabelText("Filter by session"), "s1");
    expect(address()).toBe("/admin/history?sessionId=s1&religion=hindu");
  });

  it("wires every control to its own parameter", async () => {
    // Each select writes a different key; crossing two of them silently
    // filters by the wrong thing and still looks like it worked.
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    await user.selectOptions(screen.getByLabelText("Filter by block"), "b1");
    expect(address()).toBe("/admin/history?blockId=b1");

    await user.selectOptions(screen.getByLabelText("Filter by member"), "u1");
    expect(address()).toBe("/admin/history?blockId=b1&memberId=u1");

    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    expect(address()).toBe("/admin/history?blockId=b1&memberId=u1&interestLevel=high");

    await user.type(screen.getByLabelText("Recorded from"), "2026-03-01");
    expect(address()).toBe(
      "/admin/history?blockId=b1&memberId=u1&interestLevel=high&from=2026-03-01",
    );

    await user.type(screen.getByLabelText("Recorded to"), "2026-03-31");
    expect(address()).toBe(
      "/admin/history?blockId=b1&memberId=u1&interestLevel=high&from=2026-03-01&to=2026-03-31",
    );
  });

  /* router.replace waited on a server round trip: until it answered the field
     read its old value, and a second pick, built on stale filters, dropped
     the first (#245). */
  it("shows each pick at once and keeps it through the next, before the router reports either", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    const from = screen.getByLabelText("Recorded from");
    const to = screen.getByLabelText("Recorded to");

    await user.type(from, "2026-03-01");
    expect(from).toHaveValue("2026-03-01");

    await user.type(to, "2026-03-31");
    expect(from).toHaveValue("2026-03-01");
    expect(to).toHaveValue("2026-03-31");
    expect(address()).toBe("/admin/history?from=2026-03-01&to=2026-03-31");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/history?limit=100&offset=0&from=2026-03-01T00%3A00%3A00.000Z&to=2026-03-31T23%3A59%3A59.999Z",
      );
    });
  });

  it.each([
    [
      "answers",
      (late: Held) => {
        late.resolve(list([entry("h3", { unitNumber: "#05-125" })]));
      },
    ],
    [
      "fails",
      (late: Held) => {
        late.reject(new TypeError("Load failed"));
      },
    ],
  ])("keeps the newest pick's records when an older pick %s last", async (_, settle) => {
    const user = userEvent.setup();
    const held = holdHistory((path) => new URLSearchParams(path.split("?")[1]).get("religion"));
    render(<ConsolidatedHistory />);
    await held.answer(null, list([entry("h1")]));
    await card("Blk 123, #05-123");

    const religion = screen.getByLabelText("Filter by religion");
    await user.selectOptions(religion, "hindu");
    const late = await held.waiting("hindu");
    await user.selectOptions(religion, "buddhist");
    await held.answer("buddhist", list([entry("h2", { unitNumber: "#05-124" })]));
    await card("Blk 123, #05-124");

    await act(async () => {
      settle(late);
      await Promise.resolve();
    });

    expect(screen.getByText(door("Blk 123, #05-124"))).toBeInTheDocument();
    expect(screen.queryByText(door("Blk 123, #05-125"))).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never adds a page of the old filters to the list of a newer pick", async () => {
    const user = userEvent.setup();
    const held = holdHistory((path) => {
      const query = new URLSearchParams(path.split("?")[1]);
      return `${query.get("religion") ?? "any"}@${query.get("offset") ?? ""}`;
    });
    render(<ConsolidatedHistory />);
    await held.answer("any@0", list([entry("h1")], 2));
    await card("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: /Show more/ }));
    const late = await held.waiting("any@1");
    await user.selectOptions(screen.getByLabelText("Filter by religion"), "hindu");
    await held.answer("hindu@0", list([entry("h2", { unitNumber: "#05-124" })]));
    await card("Blk 123, #05-124");
    await act(async () => {
      late.resolve(list([entry("h3", { unitNumber: "#05-125" })], 2));
      await Promise.resolve();
    });

    expect(screen.queryByText(door("Blk 123, #05-125"))).not.toBeInTheDocument();
    expect(screen.queryByText(door("Blk 123, #05-123"))).not.toBeInTheDocument();
  });

  /* Enabled again by the overtaken read, Show more sat under the old list and
     asked the new filters for the page after it: after 200 old rows, records
     101 to 200 of the new ones never appeared (#257). */
  it.each([
    ["a Show more page", "any@1"],
    ["an older pick's first page", "buddhist@0"],
  ])("keeps Show more waiting when %s lands while a newer pick loads", async (_, overtaken) => {
    const user = userEvent.setup();
    const held = holdHistory((path) => {
      const query = new URLSearchParams(path.split("?")[1]);
      return `${query.get("religion") ?? "any"}@${query.get("offset") ?? ""}`;
    });
    const asked = () =>
      apiFetch.mock.calls
        .map(([path]) => new URLSearchParams(String(path).split("?")[1]))
        .filter((query) => query.get("religion") === "hindu")
        .map((query) => query.get("offset"));
    render(<ConsolidatedHistory />);
    await held.answer("any@0", list([entry("h1")], 3));
    await card("Blk 123, #05-123");

    const religion = screen.getByLabelText("Filter by religion");
    if (overtaken === "any@1") {
      await user.click(screen.getByRole("button", { name: "Show more (1 of 3)" }));
    } else {
      await user.selectOptions(religion, "buddhist");
    }
    const late = await held.waiting(overtaken);
    await user.selectOptions(religion, "hindu");
    await held.waiting("hindu@0");
    await act(async () => {
      late.resolve(list([entry("h9", { unitNumber: "#05-129" })], 3));
      await Promise.resolve();
    });

    const waiting = screen.getByRole("button", { name: "Loading…" });
    expect(waiting).toBeDisabled();
    await user.click(waiting);
    expect(asked()).toEqual(["0"]);

    await held.answer(
      "hindu@0",
      list([entry("h2", { unitNumber: "#05-124" }), entry("h3", { unitNumber: "#05-125" })], 3),
    );
    await user.click(await screen.findByRole("button", { name: "Show more (2 of 3)" }));
    expect(asked()).toEqual(["0", "2"]);
  });

  /* Tapped while a pick's first page loaded, Show more's page went onto the
     old list, and the first page then replaced it while the count of pages
     moved on: records 101 to 200 never appeared (#257). Each request runs on
     its own, so here the further page is answered at once, before the first. */
  it("waits while a pick's first page loads, so a further page cannot skip records", async () => {
    const user = userEvent.setup();
    const numbered = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) =>
        entry(`h${String(from + i)}`, { unitNumber: `#01-${String(from + i)}` }),
      );
    let first: Held = { resolve: () => undefined, reject: () => undefined };
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      const query = new URLSearchParams(path.split("?")[1]);
      const offset = Number(query.get("offset"));
      if (query.get("religion") === null) return Promise.resolve(list([entry("h0")], 201));
      if (offset > 0) return Promise.resolve(list(numbered(offset + 1, offset + 100), 201));
      return new Promise((resolve, reject) => {
        first = { resolve, reject };
      });
    });
    const offsets = () =>
      apiFetch.mock.calls
        .map(([path]) => new URLSearchParams(String(path).split("?")[1]))
        .filter((query) => query.get("religion") === "hindu")
        .map((query) => query.get("offset"));
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    await user.selectOptions(screen.getByLabelText("Filter by religion"), "hindu");
    await waitFor(() => {
      expect(offsets()).toEqual(["0"]);
    });
    const waiting = screen.getByRole("button", { name: "Loading…" });
    expect(waiting).toBeDisabled();
    await user.click(waiting);
    expect(offsets()).toEqual(["0"]);

    await act(async () => {
      first.resolve(list(numbered(1, 100), 201));
      await Promise.resolve();
    });
    await user.click(await screen.findByRole("button", { name: "Show more (100 of 201)" }));

    expect(await screen.findByText(door("Blk 123, #01-101"))).toBeInTheDocument();
    expect(screen.getByText(door("Blk 123, #01-1"))).toBeInTheDocument();
    expect(screen.getByText(door("Blk 123, #01-200"))).toBeInTheDocument();
    expect(screen.queryByText(door("Blk 123, #05-123"))).not.toBeInTheDocument();
    expect(offsets()).toEqual(["0", "100"]);
    expect(screen.getByRole("button", { name: "Show more (200 of 201)" })).toBeEnabled();
  });

  it("reads Loading… while its own page loads, so a second tap cannot ask for it again", async () => {
    const user = userEvent.setup();
    const held = holdHistory((path) => new URLSearchParams(path.split("?")[1]).get("offset"));
    render(<ConsolidatedHistory />);
    await held.answer("0", list([entry("h1")], 3));
    await card("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Show more (1 of 3)" }));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    await held.answer("1", list([entry("h2", { unitNumber: "#05-124" })], 3));
    expect(await screen.findByRole("button", { name: "Show more (2 of 3)" })).toBeEnabled();
    expect(screen.getByText(door("Blk 123, #05-124"))).toBeInTheDocument();
  });

  it("asks for the page after the rows on screen once Try again starts the list again", async () => {
    // Counting taps instead, a page that failed was counted as loaded, and
    // the next Show more skipped it.
    const user = userEvent.setup();
    const held = holdHistory((path) => new URLSearchParams(path.split("?")[1]).get("offset"));
    render(<ConsolidatedHistory />);
    await held.answer("0", list([entry("h1")], 3));
    await card("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Show more (1 of 3)" }));
    const failed = await held.waiting("1");
    await act(async () => {
      failed.reject(new TypeError("Load failed"));
      await Promise.resolve();
    });
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await held.answer("0", list([entry("h1")], 3));
    await card("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Show more (1 of 3)" }));
    await held.answer("1", list([entry("h2", { unitNumber: "#05-124" })], 3));

    expect(await screen.findByText(door("Blk 123, #05-124"))).toBeInTheDocument();
    expect(screen.getByText(door("Blk 123, #05-123"))).toBeInTheDocument();
  });

  it("never draws a read for the filters just left that lands before the next pick's load starts", async () => {
    // The pick's load waits a tick; the screen already shows the new filter.
    vi.useFakeTimers();
    try {
      const held = new Map<string, Held>();
      apiFetch.mockImplementation((path: string) => {
        if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
        if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
        if (path.startsWith("/users")) return Promise.resolve(pickers.users);
        const religion = new URLSearchParams(path.split("?")[1]).get("religion");
        if (religion === null) return Promise.resolve(list([entry("h1")]));
        return new Promise((resolve, reject) => {
          held.set(religion, { resolve, reject });
        });
      });
      render(<ConsolidatedHistory />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(door("Blk 123, #05-123"))).toBeInTheDocument();

      const religion = screen.getByLabelText("Filter by religion");
      fireEvent.change(religion, { target: { value: "hindu" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const hindu = held.get("hindu");
      expect(hindu).toBeDefined();

      fireEvent.change(religion, { target: { value: "buddhist" } });
      await act(async () => {
        hindu?.resolve(list([entry("h3", { unitNumber: "#05-125" })]));
        for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      });

      expect(held.has("buddhist")).toBe(false);
      expect(screen.queryByText(door("Blk 123, #05-125"))).not.toBeInTheDocument();
      expect(religion).toHaveValue("buddhist");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reloads after amending, so the row is not stale", async () => {
    const user = userEvent.setup();
    serve([entry("h1", { interestLevel: "low" })]);
    render(<ConsolidatedHistory />);
    const row = await card("Blk 123, #05-123");

    await user.click(within(row).getByRole("button"));
    await user.click(screen.getByRole("radio", { name: "High" }));

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      if (path.startsWith("/visits/")) return Promise.resolve({});
      return Promise.resolve({
        data: [entry("h1", { interestLevel: "high" })],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(within(await card("Blk 123, #05-123")).getByText("High")).toBeInTheDocument();
  });

  it("closes the amend sheet without reloading when abandoned", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    const row = await card("Blk 123, #05-123");

    await user.click(within(row).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears back to a bare URL", async () => {
    const user = userEvent.setup();
    at("religion=hindu");
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(address()).toBe("/admin/history");
    expect(screen.getByLabelText("Filter by religion")).toHaveValue("");
  });

  it("searches within what is loaded, with nothing in the URL and nothing asked of the server", async () => {
    // The term is a name or a phone number: a query string would carry it to
    // the server's logs, the phone's history and a sign-in's callbackUrl (#130).
    const user = userEvent.setup();
    serve([entry("h1"), entry("h2", { unitNumber: "#05-124" })]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    apiFetch.mockClear();

    await user.type(screen.getByLabelText("Search by unit, name or contact"), "124");

    expect(screen.getByText(door("Blk 123, #05-124"))).toBeInTheDocument();
    expect(screen.queryByText(door("Blk 123, #05-123"))).not.toBeInTheDocument();
    expect(address()).toBe("/admin/history");
    // Let any deferred load run: typing must not start one.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps the search term through a filter change", async () => {
    const user = userEvent.setup();
    serve([entry("h1"), entry("h2", { unitNumber: "#05-124" })]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    const search = screen.getByLabelText("Search by unit, name or contact");
    await user.type(search, "124");

    await user.selectOptions(screen.getByLabelText("Filter by religion"), "hindu");

    // Nor is the term written along with the filter.
    expect(address()).toBe("/admin/history?religion=hindu");
    expect(search).toHaveValue("124");
  });

  it("moves an old link's search term from the address into the search (#163)", async () => {
    // Left in the address, it would ride into a sign-in's callbackUrl.
    at("q=124&religion=hindu");
    serve([entry("h1"), entry("h2", { unitNumber: "#05-124" })]);
    render(<ConsolidatedHistory />);

    expect(await screen.findByText(door("Blk 123, #05-124"))).toBeInTheDocument();
    expect(screen.queryByText(door("Blk 123, #05-123"))).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search by unit, name or contact")).toHaveValue("124");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(address()).toBe("/admin/history?religion=hindu");
    const asked = apiFetch.mock.calls.map(([path]) => String(path));
    expect(asked.filter((path) => /q=|124/.test(path))).toEqual([]);
  });

  it("clears a search typed with no other filter", async () => {
    const user = userEvent.setup();
    serve([entry("h1"), entry("h2", { unitNumber: "#05-124" })]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    await user.type(screen.getByLabelText("Search by unit, name or contact"), "124");
    expect(screen.queryByText(door("Blk 123, #05-123"))).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByLabelText("Search by unit, name or contact")).toHaveValue("");
    expect(screen.getByText(door("Blk 123, #05-123"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("appends the next page rather than replacing it", async () => {
    const user = userEvent.setup();
    serve([entry("h1")], 2);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [entry("h2", { unitNumber: "#05-124" })],
        pagination: { limit: 100, offset: 100, total: 2, hasMore: false },
      });
    });
    await user.click(screen.getByRole("button", { name: /Show more/ }));

    expect(await screen.findByText(door("Blk 123, #05-124"))).toBeInTheDocument();
    expect(screen.getByText(door("Blk 123, #05-123"))).toBeInTheDocument();
  });

  it("exports the whole filtered set, not the page on screen", async () => {
    // The promise of the button. A file holding the first hundred rows while
    // the filter matched three hundred would be worse than no export.
    const user = userEvent.setup();
    at("religion=buddhist");
    const first = Array.from({ length: 100 }, (_, i) =>
      entry(`h${String(i)}`, { unitNumber: `#05-${String(i)}` }),
    );
    let requested: string[] = [];
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      requested.push(path);
      const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset"));
      return Promise.resolve(
        offset === 0
          ? { data: first, pagination: { limit: 100, offset, total: 101, hasMore: true } }
          : {
              data: [entry("last", { unitNumber: "#09-99" })],
              pagination: { limit: 100, offset, total: 101, hasMore: false },
            },
      );
    });

    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-0"));

    requested = [];
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("Exported 101 records.")).toBeInTheDocument();
    // Every request carried the filter and asked for the largest page (#252),
    // and the second one went on from the records the first brought.
    expect(requested.every((path) => path.includes("religion=buddhist"))).toBe(true);
    expect(requested.every((path) => path.includes("limit=250"))).toBe(true);
    expect(requested.some((path) => path.includes("offset=100"))).toBe(true);
    expect(csv).toContain("#09-99");
  });

  it("applies the search term to the export as well as the screen", async () => {
    const user = userEvent.setup();
    serve([entry("h1"), entry("h2", { unitNumber: "#05-124" })]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-124"));
    await user.type(screen.getByLabelText("Search by unit, name or contact"), "124");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("Exported 1 records.")).toBeInTheDocument();
    expect(csv).toContain("#05-124");
    expect(csv).not.toContain("#05-123");
  });

  it("says so rather than quietly truncating a very large export", async () => {
    const user = userEvent.setup();
    let pages = 0;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      pages += 1;
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 100000, hasMore: true },
      });
    });
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    pages = 0;
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText(/Narrow the filters to get the rest/)).toBeInTheDocument();
    // Eight pages of 250: the 2,000 records twenty of 100 held (#252).
    expect(pages).toBe(8);
  });

  it("reports an export that failed instead of writing an empty file", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    apiFetch.mockRejectedValue(new TypeError("Load failed"));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByText("Could not export those records.")).toBeInTheDocument();
  });

  /* Disabled while it exports, Export CSV loses focus to the page (#221).
     Held until it has, as a real failure is (D-208-6). */
  it("gives focus back to Export CSV after a failed export", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    let refuse: (reason: unknown) => void = () => undefined;
    apiFetch.mockReturnValueOnce(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    const button = screen.getByRole("button", { name: "Export CSV" });
    await pressByKey(user, button);
    await screen.findByRole("button", { name: "Exporting…" });
    await focusDropped();

    refuse(new TypeError("Load failed"));
    await screen.findByText("Could not export those records.");
    expect(button).toHaveFocus();
  });

  it("says nothing has been recorded when nothing is filtered", async () => {
    serve([]);
    render(<ConsolidatedHistory />);
    expect(await screen.findByText("Nothing has been recorded yet.")).toBeInTheDocument();
  });

  it.each(["religion=hindu", "memberId=u1", "sessionId=s1", "from=2026-01-01"])(
    "says the filters match nothing with %s",
    async (query) => {
      at(query);
      serve([]);
      render(<ConsolidatedHistory />);
      expect(await screen.findByText("Nothing here matches those filters.")).toBeInTheDocument();
    },
  );

  it("says the filters match nothing when only the search excludes everything", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    await user.type(screen.getByLabelText("Search by unit, name or contact"), "zzz");
    expect(screen.getByText("Nothing here matches those filters.")).toBeInTheDocument();
  });

  it("amends any historical record", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    const row = await card("Blk 123, #05-123");
    await user.click(within(row).getByRole("button"));
    expect(screen.getByRole("dialog", { name: "Amend #05-123" })).toBeInTheDocument();
  });

  /* The pickers do not change with the filters (#252). */
  it("reads the pickers once, however often the filters change", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    await user.selectOptions(screen.getByLabelText("Filter by religion"), "buddhist");
    await user.selectOptions(screen.getByLabelText("Filter by interest level"), "high");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("interestLevel=high"));
    });

    const asked = (prefix: string) =>
      apiFetch.mock.calls.filter(([path]) => String(path).startsWith(prefix)).length;
    expect(asked("/blocks")).toBe(1);
    expect(asked("/sessions?")).toBe(1);
    expect(asked("/users")).toBe(1);
    expect(screen.getByRole("option", { name: "Blk 123" })).toBeInTheDocument();
  });

  it("asks for the pickers again with the next filter after one could not be read", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    const answer = apiFetch.getMockImplementation();
    let blocksDown = true;
    apiFetch.mockImplementation((path: string) =>
      blocksDown && path.startsWith("/blocks")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : (answer?.(path) as unknown),
    );
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));
    expect(screen.queryByRole("option", { name: "Blk 123" })).not.toBeInTheDocument();

    blocksDown = false;
    await user.selectOptions(screen.getByLabelText("Filter by religion"), "buddhist");
    expect(await screen.findByRole("option", { name: "Blk 123" })).toBeInTheDocument();
  });

  it("still lists records when a picker cannot be loaded", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/blocks")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/sessions")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/users")) return Promise.reject(new Error("nope"));
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<ConsolidatedHistory />);

    expect(await screen.findByText(door("Blk 123, #05-123"))).toBeInTheDocument();
  });

  it("offers a retry when the records fail to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ConsolidatedHistory />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the records.");

    serve([entry("h1")]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(door("Blk 123, #05-123"))).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<ConsolidatedHistory />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the records.");
  });
});

describe("teams", () => {
  const PAIR = {
    id: TEAM_ID,
    name: "Alice & Ben",
    members: [{ id: "u2", name: "Ben Lim", image: null }],
  };

  it("names the author, teammates and team on every visit", async () => {
    serve([entry("h1", { team: PAIR })]);
    render(<ConsolidatedHistory />);

    const row = await card("Blk 123, #05-123");
    expect(within(row).getByText("By Alice with Ben Lim")).toBeInTheDocument();
    expect(within(row).getByText("Team: Alice & Ben")).toBeInTheDocument();
  });

  it("offers no team filter until an outing is chosen", async () => {
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    expect(screen.queryByLabelText("Filter by team")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/teams"));
  });

  it("lists the chosen outing's teams and writes the choice to the URL", async () => {
    const user = userEvent.setup();
    at("sessionId=s1");
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);

    const picker = await screen.findByLabelText("Filter by team");
    await waitFor(() => {
      expect(within(picker).getByRole("option", { name: "Alice & Ben" })).toBeInTheDocument();
    });
    await user.selectOptions(picker, TEAM_ID);
    expect(address()).toBe(`/admin/history?sessionId=s1&teamId=${TEAM_ID}`);
  });

  it("asks the server for that team's records", async () => {
    at(`sessionId=s1&teamId=${TEAM_ID}`);
    serve([]);
    render(<ConsolidatedHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/history?limit=100&offset=0&sessionId=s1&teamId=${TEAM_ID}`,
      );
    });
  });

  it("forgets the team when the outing changes", async () => {
    const user = userEvent.setup();
    at(`sessionId=s1&teamId=${TEAM_ID}`);
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    await user.selectOptions(screen.getByLabelText("Filter by session"), "");
    expect(address()).toBe("/admin/history");
  });

  it("leaves the team picker empty when the teams cannot be listed", async () => {
    at("sessionId=s1");
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith("/teams")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    expect(screen.getByLabelText("Filter by team").querySelectorAll("option")).toHaveLength(1);
  });

  it("never shows a previous outing's teams after a quick switch", async () => {
    const late: { s1: (value: unknown) => void; fail: (error: unknown) => void } = {
      s1: () => undefined,
      fail: () => undefined,
    };
    at("sessionId=s1");
    apiFetch.mockImplementation((path: string) => {
      if (path === "/sessions/s1/teams") {
        return new Promise((resolve) => {
          late.s1 = resolve;
        });
      }
      if (path === "/sessions/s2/teams") return Promise.resolve(teamsOf("s2", "Second pair"));
      if (path === "/sessions/s3/teams") {
        return new Promise((_resolve, reject) => {
          late.fail = reject;
        });
      }
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    const { rerender } = render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });

    at("sessionId=s3");
    rerender(<ConsolidatedHistory />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s3/teams");
    });
    at("sessionId=s2");
    rerender(<ConsolidatedHistory />);
    const picker = await screen.findByLabelText("Filter by team");
    await waitFor(() => {
      expect(within(picker).getByRole("option", { name: "Second pair" })).toBeInTheDocument();
    });

    await act(async () => {
      late.s1(teamsOf("s1", "Old pair"));
      late.fail(new Error("late"));
      await Promise.resolve();
    });
    expect(within(picker).queryByRole("option", { name: "Old pair" })).not.toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Second pair" })).toBeInTheDocument();
  });

  it("exports the team and teammates", async () => {
    const user = userEvent.setup();
    serve([entry("h1", { team: PAIR })]);
    render(<ConsolidatedHistory />);
    await card("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => {
      expect(csv).toContain("Alice,Alice & Ben,Ben Lim,March outing");
    });
  });

  it("drops a team that is not one of the chosen outing's from the URL", async () => {
    const other = "0190a1b2-c3d4-7e5f-8a9b-ffffffffffff";
    at(`sessionId=s1&religion=hindu&teamId=${other}`);
    serve([]);
    render(<ConsolidatedHistory />);
    await waitFor(() => {
      expect(address()).toBe("/admin/history?sessionId=s1&religion=hindu");
    });
  });

  it("keeps a team that belongs to the outing", async () => {
    at(`sessionId=s1&teamId=${TEAM_ID}`);
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    const picker = await screen.findByLabelText("Filter by team");
    await waitFor(() => {
      expect(picker).toHaveValue(TEAM_ID);
    });
    expect(address()).toBe(`/admin/history?sessionId=s1&teamId=${TEAM_ID}`);
  });

  it("keeps the team while the outing's teams cannot be listed", async () => {
    const other = "0190a1b2-c3d4-7e5f-8a9b-ffffffffffff";
    at(`sessionId=s1&teamId=${other}`);
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith("/teams")) return Promise.reject(new Error("nope"));
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      if (path.startsWith("/users")) return Promise.resolve(pickers.users);
      return Promise.resolve({
        data: [],
        pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
      });
    });
    render(<ConsolidatedHistory />);
    await screen.findByText("Nothing here matches those filters.");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    expect(address()).toBe(`/admin/history?sessionId=s1&teamId=${other}`);
  });

  it("names the household under its door when a name is known, and the notes under each visit", async () => {
    const named = entry("h1", { description: "Asked for Mandarin material" });
    serve([
      { ...named, household: { ...named.household, name: "Tan" } },
      entry("h2", { unitNumber: "#05-124" }),
    ]);
    render(<ConsolidatedHistory />);

    const known = await card("Blk 123, #05-123");
    expect(within(known).getByText("Tan")).toBeInTheDocument();
    expect(within(known).getByText("Asked for Mandarin material")).toBeInTheDocument();
    expect(within(known).getByRole("link")).toHaveAttribute("href", "/households/h1");
    // A door nobody has named shows just its unit.
    expect(within(await card("Blk 123, #05-124")).getByRole("link")).toHaveTextContent(
      /^Blk 123, #05-124$/,
    );
  });

  it("offers a member with no name in the picker by their email", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/users")) {
        return Promise.resolve({
          ...pickers.users,
          data: pickers.users.data.map((user) => ({ ...user, name: null })),
        });
      }
      if (path.startsWith("/blocks")) return Promise.resolve(pickers.blocks);
      if (path.startsWith("/sessions")) return Promise.resolve(pickers.sessions);
      return Promise.resolve({
        data: [entry("h1")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    render(<ConsolidatedHistory />);

    expect(await screen.findByRole("option", { name: "alice@t.local" })).toHaveValue("u1");
  });

  it("reports an export that failed for no stated reason", async () => {
    const user = userEvent.setup();
    serve([entry("h1")]);
    render(<ConsolidatedHistory />);
    await screen.findByText(door("Blk 123, #05-123"));

    apiFetch.mockRejectedValue("boom");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("Could not export those records.")).toBeInTheDocument();
    expect(csv).toBe("");
  });
});
