import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberDetail } from "@/components/admin/member-detail";
import type { SignIn, User } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { formatDayTime } from "@/lib/history/dates";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const AT = "2026-03-14T11:00:00.000Z";
const USED = "2026-03-15T02:30:00.000Z";

const alice: User = {
  id: "u1",
  email: "alice@t.local",
  name: "Alice",
  image: null,
  role: "member",
  deactivatedAt: null,
  lastRecordedAt: null,
  createdAt: AT,
};

const signIn = (id: string, device: string, current = false): SignIn => ({
  id,
  device,
  signedInAt: AT,
  lastUsedAt: USED,
  current,
});

/* Answers GETs from the given state; DELETEs succeed unless told otherwise. */
function serve(
  user: User,
  signIns: SignIn[],
  onDelete: () => Promise<unknown> = () => Promise.resolve(),
) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return onDelete();
    return Promise.resolve(path.endsWith("/sign-ins") ? { data: signIns } : user);
  });
}

const deletes = () =>
  apiFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")
    .map(([path]) => path as string);

/*
 * Answers the user at once and each read of the sign-ins with the next of
 * `reads`, which a test can hold and settle in any order.
 */
function serveReads(
  user: User,
  reads: Promise<SignIn[]>[],
  onDelete: () => Promise<unknown> = () => Promise.resolve(),
) {
  let next = 0;
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return onDelete();
    if (!path.endsWith("/sign-ins")) return Promise.resolve(user);
    const read = reads[next];
    next += 1;
    if (read === undefined) throw new Error(`no read ${String(next)} of the sign-ins`);
    return read.then((data) => ({ data }));
  });
}

function held() {
  let settle: (signIns: SignIn[]) => void = () => undefined;
  const promise = new Promise<SignIn[]>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function card(device: string): HTMLElement {
  const label = screen.getAllByText(device)[0];
  const li = label?.closest("li");
  if (!li) throw new Error(`no card for ${device}`);
  return li;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MemberDetail (#125)", () => {
  it("shows who it is and each place they are signed in, with when", async () => {
    serve(alice, [signIn("s1", "Chrome on Android"), signIn("s2", "Safari on iPhone")]);
    render(<MemberDetail userId="u1" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Alice" })).toBeInTheDocument();
    expect(screen.getByText("alice@t.local")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Team" })).toHaveAttribute(
      "href",
      "/admin/team",
    );
    const phone = card("Chrome on Android");
    expect(phone).toHaveTextContent(`Signed in ${formatDayTime(AT)}`);
    expect(phone).toHaveTextContent(`Last used ${formatDayTime(USED)}`);
    expect(apiFetch).toHaveBeenCalledWith("/users/u1");
    expect(apiFetch).toHaveBeenCalledWith("/users/u1/sign-ins");
  });

  it("titles someone with no name by their email", async () => {
    serve({ ...alice, name: null }, []);
    render(<MemberDetail userId="u1" />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "alice@t.local" }),
    ).toBeInTheDocument();
  });

  it("signs one out with no confirmation, and reads the list again", async () => {
    const user = userEvent.setup();
    serve(alice, [signIn("s1", "Chrome on Android"), signIn("s2", "Safari on iPhone")]);
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");

    await user.click(within(card("Chrome on Android")).getByRole("button", { name: /^Sign out/ }));

    await waitFor(() => {
      expect(deletes()).toEqual(["/users/u1/sign-ins/s1"]);
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(apiFetch.mock.calls.filter(([path]) => path === "/users/u1/sign-ins")).toHaveLength(2);
    });
  });

  it("reads the list again, saying nothing, when that one had already ended", async () => {
    const user = userEvent.setup();
    serve(alice, [signIn("s1", "Chrome on Android")], () =>
      Promise.reject(
        new ApiRequestError(404, {
          error: { code: "not_found", message: "That sign-in has already ended." },
        }),
      ),
    );
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");
    await user.click(screen.getByRole("button", { name: /^Sign out Chrome/ }));

    await waitFor(() => {
      expect(apiFetch.mock.calls.filter(([path]) => path === "/users/u1/sign-ins")).toHaveLength(2);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /*
   * A failed end is told beside the control pressed, which reads Sign out
   * again and can be tapped: at the top of a long list the message was off
   * the screen, and the tap looked as if it did nothing.
   */
  describe("when an end fails", () => {
    const refused = () =>
      Promise.reject(
        new ApiRequestError(403, {
          error: { code: "forbidden", message: "You do not have access to this." },
        }),
      );

    async function pressSignOut(onDelete: () => Promise<unknown>) {
      const user = userEvent.setup();
      serve(alice, [signIn("s1", "Chrome on Android"), signIn("s2", "Safari on iPhone")], onDelete);
      render(<MemberDetail userId="u1" />);
      await screen.findByText("Safari on iPhone");
      await user.click(within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }));
      return user;
    }

    /* Settled: the list read again, nothing busy, the control as it was. */
    async function expectSettledWith(message: string) {
      const row = card("Safari on iPhone");
      const alert = await within(row).findByRole("alert");
      expect(alert).toHaveTextContent(message);
      await waitFor(() => {
        expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false");
      });
      const button = within(row).getByRole("button", { name: /^Sign out Safari on iPhone/ });
      expect(button).toHaveTextContent("Sign out");
      expect(button).toBeEnabled();
      // Just above the button it is about, where the admin is looking.
      expect(alert.nextElementSibling).toBe(button);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(within(card("Chrome on Android")).queryByRole("alert")).not.toBeInTheDocument();
    }

    it("shows the server's reason in that row, and lets the admin try again", async () => {
      await pressSignOut(refused);
      await expectSettledWith("You do not have access to this.");
    });

    it.each([
      ["a request that never arrived", () => Promise.reject(new TypeError("Failed to fetch"))],
      ["a failure that is not an Error", vi.fn<() => Promise<unknown>>().mockRejectedValue("boom")],
    ])(
      "says to check the connection for %s, never the browser's words",
      async (_name, onDelete) => {
        await pressSignOut(onDelete);
        await expectSettledWith("Could not sign out. Check your connection and try again.");
        expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
      },
    );

    it("stops saying Signing out once it has failed, while the list is read again", async () => {
      const user = userEvent.setup();
      const afterFailure = held();
      const iphone = signIn("s2", "Safari on iPhone");
      serveReads(alice, [Promise.resolve([iphone]), afterFailure.promise], refused);
      render(<MemberDetail userId="u1" />);
      await screen.findByText("Safari on iPhone");

      await user.click(within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }));

      const row = card("Safari on iPhone");
      expect(await within(row).findByRole("alert")).toHaveTextContent("You do not have access");
      expect(within(row).getByRole("button")).toHaveTextContent("Sign out");
      expect(screen.queryByText("Signing out…")).not.toBeInTheDocument();
      expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");

      afterFailure.settle([iphone]);
      await waitFor(() => {
        expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false");
      });
      expect(within(card("Safari on iPhone")).getByRole("button")).toBeEnabled();
    });

    it("brings the message into view with its button as it is drawn, so neither sits under the nav", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        await pressSignOut(refused);
        const row = card("Safari on iPhone");
        const alert = await within(row).findByRole("alert");
        const both = alert.parentElement;
        expect(both).toContainElement(within(row).getByRole("button"));
        /* Clear of the nav and no further: no Save bar docks on this page
           (#195). jsdom lays nothing out: the E2E measures. */
        expect(both).toHaveClass("scroll-clear-nav");
        expect(both).not.toHaveClass("scroll-clear-chrome");
        expect(scrolled.mock.contexts).toContain(both);
        expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
      } finally {
        scrolled.mockRestore();
      }
    });

    it("keeps the list when the end and the read after it both get no answer", async () => {
      // No signal at all: /api/users/* is never answered from the worker's cache.
      const user = userEvent.setup();
      let reads = 0;
      apiFetch.mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return Promise.reject(new TypeError("Failed to fetch"));
        if (!path.endsWith("/sign-ins")) return Promise.resolve(alice);
        reads += 1;
        return reads === 1
          ? Promise.resolve({
              data: [signIn("s1", "Chrome on Android"), signIn("s2", "Safari on iPhone")],
            })
          : Promise.reject(new TypeError("Failed to fetch"));
      });
      render(<MemberDetail userId="u1" />);
      await screen.findByText("Safari on iPhone");

      await user.click(within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }));

      await expectSettledWith("Could not sign out. Check your connection and try again.");
      expect(reads).toBe(2);
      expect(screen.getByText("Chrome on Android")).toBeInTheDocument();
      expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("clears an earlier failure when another end is tried, and that one works", async () => {
      const user = userEvent.setup();
      const phone = signIn("s1", "Chrome on Android");
      const iphone = signIn("s2", "Safari on iPhone");
      let refuse = true;
      serveReads(
        alice,
        [
          Promise.resolve([phone, iphone]),
          Promise.resolve([phone, iphone]),
          Promise.resolve([iphone]),
        ],
        () => (refuse ? refused() : Promise.resolve()),
      );
      render(<MemberDetail userId="u1" />);
      await screen.findByText("Safari on iPhone");

      await user.click(within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }));
      expect(await within(card("Safari on iPhone")).findByRole("alert")).toBeInTheDocument();
      await waitFor(() => {
        expect(within(card("Chrome on Android")).getByRole("button")).toBeEnabled();
      });

      refuse = false;
      await user.click(
        within(card("Chrome on Android")).getByRole("button", { name: /^Sign out/ }),
      );

      await waitFor(() => {
        expect(screen.queryByText("Chrome on Android")).not.toBeInTheDocument();
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("tells a failed Sign out everywhere just above that button", async () => {
      const user = userEvent.setup();
      serve(alice, [signIn("s1", "Chrome on Android")], refused);
      render(<MemberDetail userId="u1" />);
      await screen.findByText("Chrome on Android");

      await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Sign out everywhere",
        }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("You do not have access to this.");
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeEnabled();
      });
      expect(alert.nextElementSibling).toBe(
        screen.getByRole("button", { name: "Sign out everywhere" }),
      );
      expect(alert.parentElement).toHaveClass("scroll-clear-nav");
      expect(alert.parentElement).not.toHaveClass("scroll-clear-chrome");
      expect(within(card("Chrome on Android")).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("draws nothing once the list read again no longer has what was pressed", async () => {
      const user = userEvent.setup();
      const phone = signIn("s1", "Chrome on Android");
      const iphone = signIn("s2", "Safari on iPhone");
      serveReads(alice, [Promise.resolve([phone, iphone]), Promise.resolve([phone])], refused);
      render(<MemberDetail userId="u1" />);
      await screen.findByText("Safari on iPhone");

      await user.click(within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }));

      // Signed out after all, though the answer was lost.
      await waitFor(() => {
        expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument();
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  /*
   * Two quick Sign outs, the first's list read again answering after the
   * second's would have: the stale list would bring back a sign-in already
   * ended. So the second waits for the first's list (D-28-7).
   */
  it("holds a second Sign out until the first's list is read again, so an older list never answers last", async () => {
    const user = userEvent.setup();
    const phone = signIn("s1", "Chrome on Android");
    const iphone = signIn("s2", "Safari on iPhone");
    const firefox = signIn("s3", "Firefox on Android");
    const afterFirst = held();
    serveReads(alice, [
      Promise.resolve([phone, iphone, firefox]),
      afterFirst.promise,
      Promise.resolve([firefox]),
    ]);
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");

    await user.click(within(card("Chrome on Android")).getByRole("button", { name: /^Sign out/ }));
    await user.click(within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }));
    expect(deletes()).toEqual(["/users/u1/sign-ins/s1"]);
    expect(
      within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }),
    ).toBeDisabled();

    afterFirst.settle([iphone, firefox]);
    await waitFor(() => {
      expect(screen.queryByText("Chrome on Android")).not.toBeInTheDocument();
    });
    await user.click(within(card("Safari on iPhone")).getByRole("button", { name: /^Sign out/ }));

    await waitFor(() => {
      expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument();
    });
    expect(deletes()).toEqual(["/users/u1/sign-ins/s1", "/users/u1/sign-ins/s2"]);
    expect(screen.getByText("Firefox on Android")).toBeInTheDocument();
  });

  /* On weak signal a tap that only dims the buttons looks like it did nothing. */
  it("says it is signing out, on the control pressed and the list, until the list is read again", async () => {
    const user = userEvent.setup();
    const phone = signIn("s1", "Chrome on Android");
    const iphone = signIn("s2", "Safari on iPhone");
    const afterEnd = held();
    serveReads(alice, [Promise.resolve([phone, iphone]), afterEnd.promise]);
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("aria-busy", "false");

    await user.click(within(card("Chrome on Android")).getByRole("button", { name: /^Sign out/ }));

    const pressed = within(card("Chrome on Android")).getByRole("button", {
      name: /^Signing out Chrome on Android/,
    });
    expect(pressed).toHaveTextContent("Signing out…");
    expect(pressed).toBeDisabled();
    expect(list).toHaveAttribute("aria-busy", "true");
    // Only the control pressed says so; the others are just unavailable.
    expect(within(card("Safari on iPhone")).getByRole("button")).toHaveTextContent("Sign out");
    expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeDisabled();

    afterEnd.settle([iphone]);
    await waitFor(() => {
      expect(screen.queryByText("Chrome on Android")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByText("Signing out…")).not.toBeInTheDocument();
    expect(within(card("Safari on iPhone")).getByRole("button")).toBeEnabled();
  });

  it("says Sign out everywhere is signing out once confirmed, until the list is read again", async () => {
    const user = userEvent.setup();
    const afterEnd = held();
    serveReads(alice, [
      Promise.resolve([signIn("s1", "Chrome on Android"), signIn("s2", "Safari on iPhone")]),
      afterEnd.promise,
    ]);
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");

    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out everywhere" }),
    );

    expect(await screen.findByRole("button", { name: "Signing out…" })).toBeDisabled();
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");

    afterEnd.settle([]);
    expect(await screen.findByText("Not signed in anywhere.")).toBeInTheDocument();
    expect(screen.queryByText("Signing out…")).not.toBeInTheDocument();
  });

  it("shows the newest read of the list when an older one answers last (D-28-7)", async () => {
    // Try again, tapped twice on a weak signal.
    const user = userEvent.setup();
    const older = held();
    const newer = held();
    apiFetch.mockRejectedValueOnce(new Error("Could not reach the server."));
    render(<MemberDetail userId="u1" />);
    await screen.findByRole("alert");

    serveReads(alice, [older.promise, newer.promise]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    newer.settle([signIn("s2", "Safari on iPhone")]);
    expect(await screen.findByText("Safari on iPhone")).toBeInTheDocument();
    older.settle([signIn("s1", "Chrome on Android"), signIn("s2", "Safari on iPhone")]);
    await older.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("Chrome on Android")).not.toBeInTheDocument();
  });

  it("drops an older read that fails after a newer one has answered", async () => {
    const user = userEvent.setup();
    const newer = held();
    let failOlder: (error: Error) => void = () => undefined;
    const older = new Promise<SignIn[]>((_resolve, reject) => {
      failOlder = reject;
    });
    apiFetch.mockRejectedValueOnce(new Error("Could not reach the server."));
    render(<MemberDetail userId="u1" />);
    await screen.findByRole("alert");

    serveReads(alice, [older, newer.promise]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    newer.settle([signIn("s2", "Safari on iPhone")]);
    expect(await screen.findByText("Safari on iPhone")).toBeInTheDocument();
    failOlder(new Error("Could not reach the server."));
    await older.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Safari on iPhone")).toBeInTheDocument();
  });

  it("asks before signing them out everywhere, and says their unsent records stay", async () => {
    const user = userEvent.setup();
    serve(alice, [signIn("s1", "Chrome on Android"), signIn("s2", "Safari on iPhone")]);
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");

    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    const dialog = screen.getByRole("alertdialog", { name: "Sign Alice out everywhere?" });
    expect(dialog).toHaveTextContent("Records not yet sent stay on those phones.");
    expect(deletes()).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Keep as it is" }));
    expect(deletes()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out everywhere" }),
    );
    await waitFor(() => {
      expect(deletes()).toEqual(["/users/u1/sign-ins"]);
    });
  });

  describe("on your own page", () => {
    it("tags this phone, offers it no Sign out, and signs out only your other devices", async () => {
      const user = userEvent.setup();
      serve({ ...alice, role: "admin" }, [
        signIn("s1", "Safari on iPhone", true),
        signIn("s2", "Chrome on Android"),
      ]);
      render(<MemberDetail userId="u1" />);
      await screen.findByText("Chrome on Android");

      const here = card("Safari on iPhone");
      expect(within(here).getByText("This phone")).toBeInTheDocument();
      expect(within(here).queryByRole("button")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Sign out other devices" }));
      expect(
        screen.getByRole("alertdialog", { name: "Sign out your other devices?" }),
      ).toBeInTheDocument();
    });

    it("offers nothing to end when this phone is the only one", async () => {
      serve(alice, [signIn("s1", "Safari on iPhone", true)]);
      render(<MemberDetail userId="u1" />);
      await screen.findByText("This phone");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  it("says when they are not signed in anywhere", async () => {
    serve(alice, []);
    render(<MemberDetail userId="u1" />);
    expect(await screen.findByText("Not signed in anywhere.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out everywhere" })).not.toBeInTheDocument();
  });

  it("says a deactivated member is signed out everywhere", async () => {
    serve({ ...alice, deactivatedAt: AT }, []);
    render(<MemberDetail userId="u1" />);
    expect(await screen.findByText("Deactivated, so signed out everywhere.")).toBeInTheDocument();
  });

  it("offers a retry when the member cannot be loaded", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValueOnce(new TypeError("Load failed"));
    render(<MemberDetail userId="u1" />);

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this member.");
    serve(alice, []);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Alice" })).toBeInTheDocument();
  });

  it("shows the server's sentence when it refuses the member", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(404, { error: { code: "not_found", message: "No such user." } }),
    );
    render(<MemberDetail userId="u1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No such user.");
  });

  it("copes with a load failure that is not an Error", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<MemberDetail userId="u1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this member.");
  });
});
