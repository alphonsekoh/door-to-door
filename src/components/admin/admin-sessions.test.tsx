import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSessions } from "@/components/admin/admin-sessions";
import type { OutingSession, SessionStatus } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { landWhileTyping } from "../../../test/land-while-typing";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

function session(id: string, title: string, status: SessionStatus): OutingSession {
  return {
    id,
    title,
    kind: "regular",
    status,
    startedAt: null,
    endedAt: null,
    createdBy: { id: "admin", name: "Admin", image: null },
    createdAt: "2026-03-01T00:00:00.000Z",
  };
}

const page = (rows: OutingSession[]) => ({
  data: rows,
  pagination: { limit: 25, offset: 0, total: rows.length, hasMore: false },
});

const listReads = () =>
  apiFetch.mock.calls.filter(([path]) => path === "/sessions?limit=25").length;

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest("li");
  if (row === null) throw new Error(`no row for ${title}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminSessions", () => {
  it("lists the outings with their status in words", async () => {
    apiFetch.mockResolvedValue(
      page([session("s1", "June outing", "active"), session("s2", "March outing", "ended")]),
    );
    render(<AdminSessions />);

    expect(await screen.findByText("June outing")).toBeInTheDocument();
    expect(screen.getByText("Running now")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("puts reopen on the row itself, not behind the detail screen", async () => {
    // The acceptance criterion: two taps from here. Burying it costs a member
    // their work while an admin hunts for it.
    apiFetch.mockResolvedValue(page([session("s2", "March outing", "ended")]));
    render(<AdminSessions />);

    expect(await screen.findByRole("button", { name: "Reopen session" })).toBeInTheDocument();
  });

  it("offers start on a draft and end on a running outing", async () => {
    apiFetch.mockResolvedValue(
      page([session("s1", "Draft outing", "draft"), session("s2", "Live outing", "active")]),
    );
    render(<AdminSessions />);

    expect(await screen.findByRole("button", { name: "Start session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();
  });

  it("links each outing to its detail screen", async () => {
    apiFetch.mockResolvedValue(page([session("s1", "June outing", "active")]));
    render(<AdminSessions />);

    expect(await screen.findByRole("link", { name: /June outing/ })).toHaveAttribute(
      "href",
      "/admin/sessions/s1",
    );
  });

  it("reloads after an action so the status is not stale", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([session("s1", "Draft outing", "draft")]));
    render(<AdminSessions />);
    await screen.findByText("Draft outing");

    apiFetch.mockImplementation((path: string) =>
      path === "/sessions/s1/start"
        ? Promise.resolve(session("s1", "Draft outing", "active"))
        : Promise.resolve(page([session("s1", "Draft outing", "active")])),
    );
    await user.click(screen.getByRole("button", { name: "Start session" }));

    expect(await screen.findByText("Running now")).toBeInTheDocument();
  });

  /* Near the foot of the list, a failure under its row landed under the nav
     (#213). jsdom lays nothing out: e2e/session-lifecycle.spec.ts measures. */
  it("says a failed action under its row, bringing into view that and the button, not the title", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      const user = userEvent.setup();
      apiFetch.mockResolvedValue(
        page([session("s1", "June outing", "ended"), session("s2", "Draft outing", "draft")]),
      );
      render(<AdminSessions />);
      await screen.findByText("Draft outing");
      const clash =
        "Another session is already active. End it before starting or reopening this one.";
      let reread: (value: unknown) => void = () => undefined;
      apiFetch.mockImplementation((path: string) =>
        path === "/sessions/s2/start"
          ? Promise.reject(
              new ApiRequestError(409, {
                error: { code: "session_already_active", message: clash },
              }),
            )
          : new Promise((resolve) => {
              reread = resolve;
            }),
      );
      const start = screen.getByRole("button", { name: "Start session" });

      await user.click(start);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(clash);
      const row = screen.getByText("Draft outing").closest("li");
      if (row === null) throw new Error("no row for Draft outing");
      expect(row).toContainElement(alert);
      expect(screen.getByText("June outing").closest("li")).not.toContainElement(alert);
      expect(scrolled.mock.contexts).toEqual([alert, start]);
      /* At the largest text the title alone is 100 to 200px over the button,
         and with it the two no longer fit above the nav. */
      const title = screen.getByRole("link", { name: /Draft outing/ });
      for (const each of scrolled.mock.contexts) expect(each).not.toContainElement(title);

      // Read again, it shows the session another admin started (#226).
      expect(listReads()).toBe(2);
      reread(
        page([
          session("s3", "Live outing", "active"),
          session("s1", "June outing", "ended"),
          session("s2", "Draft outing", "draft"),
        ]),
      );
      expect(await screen.findByText("Live outing")).toBeInTheDocument();
      expect(within(row).getByRole("alert")).toBe(alert);
      // Start is still Start, so nothing is brought into view again.
      expect(scrolled.mock.contexts).toEqual([alert, start]);
    } finally {
      scrolled.mockRestore();
    }
  });

  /* Ended or started by another admin, a session moved under the list,
     which went on offering End beside "has already ended" (#226). */
  describe("a press refused because the session moved elsewhere", () => {
    const ENDED = "This session has already ended, so it cannot be ended.";

    it("reads the list again, and turns End into Reopen in place, still saying why", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const user = userEvent.setup();
        apiFetch.mockResolvedValue(page([session("s1", "June outing", "active")]));
        render(<AdminSessions />);
        const end = await screen.findByRole("button", { name: "End session" });
        let reread: (value: unknown) => void = () => undefined;
        apiFetch.mockImplementation((path: string) =>
          path === "/sessions/s1/end"
            ? Promise.reject(
                new ApiRequestError(409, { error: { code: "conflict", message: ENDED } }),
              )
            : new Promise((resolve) => {
                reread = resolve;
              }),
        );

        await user.click(end);
        await user.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
        );
        const row = rowOf("June outing");
        const alert = await within(row).findByRole("alert");
        expect(alert).toHaveTextContent(ENDED);
        await waitFor(() => {
          expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        });
        expect(listReads()).toBe(2);
        const before = scrolled.mock.calls.length;

        reread(page([session("s1", "June outing", "ended")]));

        expect(await within(row).findByText("Ended")).toBeInTheDocument();
        expect(within(row).queryByText("Running now")).toBeNull();
        expect(within(row).queryByRole("button", { name: "End session" })).toBeNull();
        /* The very button End was, so the focus End's confirm gave back
           stays on it (D-90-9), and so does the failure under it. */
        const reopen = within(row).getByRole("button", { name: "Reopen session" });
        expect(reopen).toBe(end);
        expect(reopen).toHaveFocus();
        expect(within(row).getByRole("alert")).toBe(alert);
        expect(alert).toHaveTextContent(ENDED);
        expect(scrolled.mock.contexts.slice(before)).toEqual([alert, reopen]);
      } finally {
        scrolled.mockRestore();
      }
    });

    it.each([
      ["Start session", "draft", "/sessions/s1/start", "started"],
      ["Reopen session", "ended", "/sessions/s1/reopen", "reopened"],
    ] as const)(
      "reads a refused %s back as running, offering End",
      async (label, status, path, done) => {
        const refusal = `This session is already running, so it cannot be ${done}.`;
        const user = userEvent.setup();
        apiFetch.mockResolvedValue(page([session("s1", "June outing", status)]));
        render(<AdminSessions />);
        const pressed = await screen.findByRole("button", { name: label });
        apiFetch.mockImplementation((asked: string) =>
          asked === path
            ? Promise.reject(
                new ApiRequestError(409, { error: { code: "conflict", message: refusal } }),
              )
            : Promise.resolve(page([session("s1", "June outing", "active")])),
        );

        await user.click(pressed);

        const row = rowOf("June outing");
        expect(await within(row).findByText("Running now")).toBeInTheDocument();
        expect(within(row).getByRole("button", { name: "End session" })).toBe(pressed);
        expect(within(row).queryByRole("button", { name: label })).toBeNull();
        expect(within(row).getByRole("alert")).toHaveTextContent(refusal);
      },
    );

    /* Read back as it was, a draft, the clash was left armed for the next
       change: the reload after another row's press drew End under it, and
       scrolled the screen away from the row just pressed. */
    it("drops a clash's sentence once a later reload finds that session started elsewhere", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const clash =
          "Another session is already active. End it before starting or reopening this one.";
        const user = userEvent.setup();
        apiFetch.mockResolvedValue(
          page([session("s1", "June outing", "active"), session("s2", "Draft outing", "draft")]),
        );
        render(<AdminSessions />);
        await screen.findByText("Draft outing");
        apiFetch.mockImplementation((path: string) =>
          path === "/sessions/s2/start"
            ? Promise.reject(
                new ApiRequestError(409, {
                  error: { code: "session_already_active", message: clash },
                }),
              )
            : Promise.resolve(
                page([
                  session("s3", "July outing", "draft"),
                  session("s1", "June outing", "active"),
                  session("s2", "Draft outing", "draft"),
                ]),
              ),
        );
        await user.click(within(rowOf("Draft outing")).getByRole("button"));
        // Its re-read, with one another admin made since: still a draft.
        expect(await screen.findByText("July outing")).toBeInTheDocument();
        const draft = rowOf("Draft outing");
        expect(within(draft).getByRole("alert")).toHaveTextContent(clash);
        expect(within(draft).getByRole("button", { name: "Start session" })).toBeInTheDocument();

        // Another admin ends June and starts Draft; this list still shows June running.
        let reread: (value: unknown) => void = () => undefined;
        apiFetch.mockImplementation((path: string) =>
          path === "/sessions/s1/end"
            ? Promise.reject(
                new ApiRequestError(409, { error: { code: "conflict", message: ENDED } }),
              )
            : new Promise((resolve) => {
                reread = resolve;
              }),
        );
        const june = rowOf("June outing");
        await user.click(within(june).getByRole("button", { name: "End session" }));
        await user.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
        );
        const ended = await within(june).findByRole("alert");
        await waitFor(() => {
          expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        });
        const before = scrolled.mock.calls.length;

        reread(
          page([
            session("s3", "July outing", "draft"),
            session("s1", "June outing", "ended"),
            session("s2", "Draft outing", "active"),
          ]),
        );

        expect(await within(draft).findByText("Running now")).toBeInTheDocument();
        expect(within(draft).getByRole("button", { name: "End session" })).toBeInTheDocument();
        expect(within(draft).queryByRole("alert")).toBeNull();
        // June's refusal is its own, and only June is brought into view.
        const reopen = within(june).getByRole("button", { name: "Reopen session" });
        expect(within(june).getByRole("alert")).toBe(ended);
        expect(ended).toHaveTextContent(ENDED);
        expect(scrolled.mock.contexts.slice(before)).toEqual([ended, reopen]);
      } finally {
        scrolled.mockRestore();
      }
    });

    it("leaves the list as it is when the press never reached the server", async () => {
      const user = userEvent.setup();
      apiFetch.mockResolvedValue(page([session("s1", "June outing", "draft")]));
      render(<AdminSessions />);
      const start = await screen.findByRole("button", { name: "Start session" });
      apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      await user.click(start);

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not do that.");
      expect(listReads()).toBe(1);
      expect(screen.getByText("June outing")).toBeInTheDocument();
    });
  });

  /* Two refusals each read the list again, and on a slow line the answers
     can cross: an older one landing last drew "Running now" over a session
     read since as ended (#234). Only the newest read is drawn (D-28-7). */
  describe("two reads of the list that cross", () => {
    const ENDED = "This session has already ended, so it cannot be ended.";
    const CLASH =
      "Another session is already active. End it before starting or reopening this one.";
    const JULY = session("s3", "July outing", "draft");

    /* June runs and Draft waits. Start on Draft and End on June are each
       refused with a 409, and every read of the list after the first is
       held until the test answers it. */
    async function setUp() {
      const user = userEvent.setup();
      apiFetch.mockResolvedValue(
        page([session("s1", "June outing", "active"), session("s2", "Draft outing", "draft")]),
      );
      render(<AdminSessions />);
      await screen.findByText("Draft outing");
      const held: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = [];
      apiFetch.mockImplementation((path: string) => {
        if (path === "/sessions/s1/end") {
          return Promise.reject(
            new ApiRequestError(409, { error: { code: "conflict", message: ENDED } }),
          );
        }
        if (path === "/sessions/s2/start") {
          return Promise.reject(
            new ApiRequestError(409, { error: { code: "session_already_active", message: CLASH } }),
          );
        }
        return new Promise((resolve, reject) => {
          held.push({ resolve, reject });
        });
      });
      const read = (index: number) => {
        const each = held[index];
        if (each === undefined) throw new Error(`read ${String(index)} was never sent`);
        return each;
      };
      const june = rowOf("June outing");
      const draft = rowOf("Draft outing");
      const end = within(june).getByRole("button", { name: "End session" });

      return {
        june,
        draft,
        end,
        refuseStart: async () => {
          await user.click(within(draft).getByRole("button", { name: "Start session" }));
          return within(draft).findByRole("alert");
        },
        refuseEnd: async () => {
          await user.click(end);
          await user.click(
            within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
          );
          const alert = await within(june).findByRole("alert");
          await waitFor(() => {
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
          });
          return alert;
        },
        /* Answers a held read and lets it run its course, drawing whatever
           it sets before the test looks. */
        answer: (index: number, rows: OutingSession[]) =>
          act(async () => {
            read(index).resolve(page(rows));
            await new Promise((resolve) => setTimeout(resolve, 0));
          }),
        fail: (index: number, error: unknown) =>
          act(async () => {
            read(index).reject(error);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }),
      };
    }

    it("keeps a session read as ended when an older read of it running lands last", async () => {
      const { june, draft, end, refuseStart, refuseEnd, answer } = await setUp();
      const clash = await refuseStart();
      const ended = await refuseEnd();
      expect(listReads()).toBe(3);

      await answer(1, [
        session("s1", "June outing", "ended"),
        session("s2", "Draft outing", "draft"),
      ]);
      expect(within(june).getByText("Ended")).toBeInTheDocument();
      expect(within(june).getByRole("button", { name: "Reopen session" })).toBe(end);

      // Start's re-read, sent before another admin ended June.
      await answer(0, [
        session("s1", "June outing", "active"),
        session("s2", "Draft outing", "draft"),
      ]);

      expect(within(june).getByText("Ended")).toBeInTheDocument();
      expect(screen.queryByText("Running now")).toBeNull();
      expect(within(june).getByRole("button", { name: "Reopen session" })).toBe(end);
      expect(within(june).getByRole("alert")).toBe(ended);
      expect(ended).toHaveTextContent(ENDED);
      expect(within(draft).getByRole("alert")).toBe(clash);
    });

    /* Counted, the older answer ended End's wait for its re-read, and the
       re-read's change to Reopen then dropped "has already ended". */
    it("neither draws an older read that lands first nor ends a refused row's wait on it", async () => {
      const { june, end, refuseStart, refuseEnd, answer } = await setUp();
      await refuseStart();
      const ended = await refuseEnd();

      await answer(0, [
        JULY,
        session("s1", "June outing", "active"),
        session("s2", "Draft outing", "draft"),
      ]);
      expect(screen.queryByText("July outing")).toBeNull();
      expect(within(june).getByText("Running now")).toBeInTheDocument();
      expect(within(june).getByRole("alert")).toBe(ended);

      await answer(1, [
        JULY,
        session("s1", "June outing", "ended"),
        session("s2", "Draft outing", "draft"),
      ]);

      expect(screen.getByText("July outing")).toBeInTheDocument();
      expect(within(june).getByText("Ended")).toBeInTheDocument();
      expect(within(june).getByRole("button", { name: "Reopen session" })).toBe(end);
      expect(within(june).getByRole("alert")).toBe(ended);
      expect(ended).toHaveTextContent(ENDED);
    });

    /* Sent after End's refusal, another row's re-read shows the state "has
       already ended" names, or a later one: it ends End's wait as End's own
       re-read would, keeping the sentence under Reopen and in view. */
    it("lets a newer read set off by another row end a refused row's wait", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const { june, end, refuseStart, refuseEnd, answer } = await setUp();
        const ended = await refuseEnd();
        await refuseStart();
        expect(listReads()).toBe(3);
        const before = scrolled.mock.calls.length;

        await answer(1, [
          JULY,
          session("s1", "June outing", "ended"),
          session("s2", "Draft outing", "draft"),
        ]);

        const reopen = within(june).getByRole("button", { name: "Reopen session" });
        expect(reopen).toBe(end);
        expect(within(june).getByRole("alert")).toBe(ended);
        expect(ended).toHaveTextContent(ENDED);
        expect(scrolled.mock.contexts.slice(before)).toEqual([ended, reopen]);

        // End's own re-read, sent before July was made.
        await answer(0, [
          session("s1", "June outing", "ended"),
          session("s2", "Draft outing", "draft"),
        ]);

        expect(screen.getByText("July outing")).toBeInTheDocument();
        expect(within(june).getByRole("alert")).toBe(ended);
        expect(scrolled.mock.contexts.slice(before)).toEqual([ended, reopen]);
      } finally {
        scrolled.mockRestore();
      }
    });

    it("drops an older read that fails after a newer one has drawn the list", async () => {
      const { june, refuseStart, refuseEnd, answer, fail } = await setUp();
      await refuseStart();
      await refuseEnd();
      await answer(1, [
        session("s1", "June outing", "ended"),
        session("s2", "Draft outing", "draft"),
      ]);

      await fail(0, new TypeError("Failed to fetch"));

      expect(screen.queryByText("Could not load the sessions.")).toBeNull();
      expect(within(june).getByText("Ended")).toBeInTheDocument();
      expect(screen.getByText("Draft outing")).toBeInTheDocument();
    });
  });

  it("tells an admin with no outings what to do first", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions />);
    expect(await screen.findByText("No sessions yet.")).toBeInTheDocument();
  });

  it("shows the newly created outing without a manual refresh", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions />);
    await screen.findByText("No sessions yet.");

    apiFetch.mockImplementation((path: string) =>
      path === "/sessions"
        ? Promise.resolve(session("s1", "Saturday morning", "draft"))
        : Promise.resolve(page([session("s1", "Saturday morning", "draft")])),
    );
    await user.click(screen.getByRole("button", { name: "New session" }));
    await user.type(screen.getByLabelText("Name this session"), "Saturday morning");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Saturday morning")).toBeInTheDocument();
  });

  /* The list draws New session's form again: landing inside the input event
     of a name being typed, it must not put back the empty name (#171). */
  it("keeps a name typed in New session as the list lands", async () => {
    const user = userEvent.setup();
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions?")
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve({
            data: [],
            pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
          }),
    );
    render(<AdminSessions />);
    await user.click(screen.getByRole("button", { name: "New session" }));
    await screen.findByText("Add households to the follow-up list first.");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions?limit=25");
    });
    const field = screen.getByLabelText<HTMLInputElement>("Name this session");

    await landWhileTyping(field, "Saturday morning", () => {
      answer(page([session("s1", "June outing", "draft")]));
    });

    expect(field).toHaveValue("Saturday morning");
    expect(await screen.findByText("June outing")).toBeInTheDocument();
    expect(field).toHaveValue("Saturday morning");
  });

  it("offers a retry when the list fails to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AdminSessions />);

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the sessions.");
    // Only the list failed: a session can still be created.
    expect(screen.getByRole("button", { name: "New session" })).toBeEnabled();

    apiFetch.mockResolvedValue(page([session("s1", "June outing", "active")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("June outing")).toBeInTheDocument();
  });

  it("shows the server's sentence when it refuses the list", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "Admins only." } }),
    );
    render(<AdminSessions />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Admins only.");
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AdminSessions />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the sessions.");
  });
});

describe("follow-up sessions and the list", () => {
  it("marks a follow-up session on its row", async () => {
    apiFetch.mockResolvedValue(
      page([
        { ...session("s1", "Revisits", "draft"), kind: "follow_up" },
        session("s2", "Knocking", "draft"),
      ]),
    );
    render(<AdminSessions />);
    const revisits = (await screen.findByText("Revisits")).closest("li");
    expect(revisits).toHaveTextContent("Follow-up");
    expect(screen.getByText("Knocking").closest("li")).not.toHaveTextContent("Follow-up");
  });

  it("leads to the follow-up list and the other admin screens", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions />);
    const screens = await screen.findByRole("navigation", { name: "Admin screens" });
    expect(
      within(screens)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Follow-up list", "/admin/follow-ups"],
      ["Needs a return visit", "/admin/attention"],
      ["All records", "/admin/history"],
      ["Team", "/admin/team"],
    ]);
  });

  it("puts New session first, then the notices, then the links, so it is in reach on a short phone", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions notices={<p>2 suggestions to review</p>} />);
    const order = [
      await screen.findByRole("button", { name: "New session" }),
      screen.getByText("2 suggestions to review"),
      screen.getByRole("navigation", { name: "Admin screens" }),
      await screen.findByText("No sessions yet."),
    ];
    order.slice(1).forEach((later, i) => {
      const earlier = order[i];
      if (earlier === undefined) throw new Error("expected an earlier element");
      expect(
        earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("offers New session, the notices and the links while the list is still loading", () => {
    apiFetch.mockReturnValue(new Promise(() => undefined));
    render(<AdminSessions notices={<p>2 overdue follow-ups</p>} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New session" })).toBeEnabled();
    expect(screen.getByText("2 overdue follow-ups")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
  });
});
