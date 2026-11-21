import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberList, lastActiveLabel } from "@/components/admin/member-list";
import type { Role, User } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { formatDay } from "@/lib/history/dates";
import { nextFrame } from "../../../test/next-frame";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

/* Each approval section reads and acts for itself (approval-requests.test.tsx);
   here, where Team puts them and what it does when one reports a change. */
type SectionProps = { approval: string; version: number; onChanged: (change: string) => void };
const { sections } = vi.hoisted(() => ({ sections: new Map<string, SectionProps>() }));
vi.mock("@/components/admin/approval-requests", () => ({
  ApprovalRequests: (props: SectionProps) => {
    sections.set(props.approval, props);
    return <p>{`${props.approval} section, version ${String(props.version)}`}</p>;
  },
}));

function section(approval: string): SectionProps {
  const found = sections.get(approval);
  if (!found) throw new Error(`no ${approval} section`);
  return found;
}

const AT = "2026-03-14T11:00:00.000Z";

function member(
  id: string,
  name: string,
  options: { role?: Role; deactivated?: boolean; lastRecordedAt?: string | null } = {},
): User {
  const { role = "member", deactivated = false, lastRecordedAt = AT } = options;
  return {
    id,
    email: `${name.toLowerCase()}@t.local`,
    name,
    image: null,
    role,
    approval: "approved",
    deactivatedAt: deactivated ? AT : null,
    lastRecordedAt,
    createdAt: AT,
  };
}

const page = (users: User[]) => ({
  data: users,
  pagination: { limit: 100, offset: 0, total: users.length, hasMore: false },
});

function row(name: string): HTMLElement {
  const heading = screen.getByText(new RegExp(`^${name}`));
  const card = heading.closest("li");
  if (!card) throw new Error(`no row for ${name}`);
  return card;
}

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({
    userId: "admin",
    role: "admin",
    isAdmin: true,
    isMember: false,
    isLoading: false,
    isSignedIn: true,
  });
});

describe("lastActiveLabel", () => {
  it("names an account nobody has used", () => {
    expect(lastActiveLabel(null)).toBe("never recorded");
  });

  it("dates the last record", () => {
    const day = new Date(2026, 2, 14, 12).toISOString();
    expect(lastActiveLabel(day)).toBe(`last recorded ${formatDay(day)}`);
  });
});

describe("MemberList", () => {
  it("lists the team with role and last activity", async () => {
    apiFetch.mockResolvedValue(
      page([member("u1", "Alice"), member("u2", "Ben", { lastRecordedAt: null })]),
    );
    render(<MemberList googleDomains={null} />);

    expect(await screen.findByText(/^Alice/)).toBeInTheDocument();
    expect(within(row("Alice")).getByText("Member")).toBeInTheDocument();
    expect(within(row("Ben")).getByText("never recorded")).toBeInTheDocument();
  });

  it("includes deactivated people, because this is where they come back", async () => {
    apiFetch.mockResolvedValue(page([member("u1", "Alice", { deactivated: true })]));
    render(<MemberList googleDomains={null} />);

    await screen.findByText(/^Alice/);
    expect(apiFetch).toHaveBeenCalledWith("/users?limit=100&includeDeactivated=true");
    expect(within(row("Alice")).getByText("Deactivated")).toBeInTheDocument();
    expect(within(row("Alice")).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
  });

  it("promotes a member", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    await user.click(within(row("Alice")).getByRole("button", { name: "Make an admin" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/users/u1", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      });
    });
  });

  it("demotes an admin", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u2", "Ben", { role: "admin" })]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Ben/);

    await user.click(within(row("Ben")).getByRole("button", { name: "Make a member" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/users/u2", {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
      });
    });
  });

  it("offers neither control on your own row", async () => {
    // The server refuses both; this saves an admin finding out by trying.
    apiFetch.mockResolvedValue(page([member("admin", "Boss", { role: "admin" })]));
    render(<MemberList googleDomains={null} />);

    await screen.findByText(/^Boss/);
    expect(screen.queryByRole("button", { name: /Make a/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot change your own role/)).toBeInTheDocument();
  });

  it("links every card, yours included, to that person's sign-ins (#125)", async () => {
    apiFetch.mockResolvedValue(
      page([member("admin", "Boss", { role: "admin" }), member("u1", "Alice")]),
    );
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    expect(within(row("Alice")).getByRole("link", { name: "Sign-ins for Alice" })).toHaveAttribute(
      "href",
      "/admin/team/u1",
    );
    expect(within(row("Boss")).getByRole("link", { name: "Sign-ins for Boss" })).toHaveAttribute(
      "href",
      "/admin/team/admin",
    );
  });

  it("says on deactivating that they are signed out everywhere", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);
    await user.click(within(row("Alice")).getByRole("button", { name: "Deactivate" }));
    expect(screen.getByText(/signed out on every phone/)).toBeInTheDocument();
  });

  it("marks which row is you", async () => {
    apiFetch.mockResolvedValue(page([member("admin", "Boss", { role: "admin" })]));
    render(<MemberList googleDomains={null} />);
    expect(await screen.findByText(/\(you\)/)).toBeInTheDocument();
  });

  it("asks before deactivating, and says the records survive", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    await user.click(within(row("Alice")).getByRole("button", { name: "Deactivate" }));
    expect(screen.getByRole("alertdialog", { name: "Deactivate Alice?" })).toBeInTheDocument();
    expect(screen.getByText(/stays attributed to them/)).toBeInTheDocument();
  });

  it("deactivates nobody until it is confirmed", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    await user.click(within(row("Alice")).getByRole("button", { name: "Deactivate" }));
    await user.click(screen.getByRole("button", { name: "Keep as it is" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("deactivates once confirmed", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    await user.click(within(row("Alice")).getByRole("button", { name: "Deactivate" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/users/u1", {
        method: "PATCH",
        body: JSON.stringify({ deactivated: true }),
      });
    });
  });

  it("reactivates somebody", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice", { deactivated: true })]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    await user.click(within(row("Alice")).getByRole("button", { name: "Reactivate" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/users/u1", {
        method: "PATCH",
        body: JSON.stringify({ deactivated: false }),
      });
    });
  });

  it("shows the server's own refusal rather than a generic one", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    apiFetch.mockRejectedValue(
      new ApiRequestError(409, {
        error: { code: "conflict", message: "You cannot change your own role." },
      }),
    );
    await user.click(within(row("Alice")).getByRole("button", { name: "Make an admin" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot change your own role.");
  });

  it("says its own sentence when a change gets no answer", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await user.click(within(row("Alice")).getByRole("button", { name: "Make an admin" }));

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not make that change.");
  });

  it("copes with a non-Error change failure", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    apiFetch.mockRejectedValue("boom");
    await user.click(within(row("Alice")).getByRole("button", { name: "Make an admin" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not make that change.");
  });

  /* Said once above the list, a failure was off the screen for a row further
     down (#213). jsdom lays nothing out: the verifier measures on both phones. */
  describe("a failed change, said in its row", () => {
    it("says it just above that row's controls and brings both into view, taking no focus", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const user = userEvent.setup();
        apiFetch.mockResolvedValue(page([member("u1", "Alice"), member("u2", "Ben")]));
        render(<MemberList googleDomains={null} />);
        await screen.findByText(/^Ben/);
        // The list opens at its top, not scrolled down to a row.
        expect(scrolled).not.toHaveBeenCalled();

        apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        const button = within(row("Ben")).getByRole("button", { name: "Make an admin" });
        await user.click(button);

        const alert = await within(row("Ben")).findByRole("alert");
        expect(alert).toHaveTextContent("Could not make that change.");
        expect(within(row("Alice")).queryByRole("alert")).not.toBeInTheDocument();
        const both = alert.parentElement;
        expect(alert.nextElementSibling).toContainElement(button);
        expect(both).toContainElement(
          within(row("Ben")).getByRole("button", { name: "Deactivate" }),
        );
        /* Clear of the nav and a floating banner, and no further: no Save bar
           docks on Team. */
        expect(both).toHaveClass("scroll-clear-nav");
        expect(both).not.toHaveClass("scroll-clear-chrome");
        expect(scrolled.mock.contexts).toEqual([both]);
        expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
        // Heard, not focused (D-164-1); where focus goes is pinned below.
        expect(alert).not.toHaveFocus();
      } finally {
        scrolled.mockRestore();
      }
    });

    it("says a failed deactivation in that row once the confirm has closed", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const user = userEvent.setup();
        apiFetch.mockResolvedValue(page([member("u1", "Alice"), member("u2", "Ben")]));
        render(<MemberList googleDomains={null} />);
        await screen.findByText(/^Ben/);

        apiFetch.mockRejectedValue(
          new ApiRequestError(409, {
            error: { code: "conflict", message: "You cannot deactivate yourself." },
          }),
        );
        await user.click(within(row("Ben")).getByRole("button", { name: "Deactivate" }));
        await user.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "Deactivate" }),
        );

        const alert = await within(row("Ben")).findByRole("alert");
        expect(alert).toHaveTextContent("You cannot deactivate yourself.");
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(within(row("Alice")).queryByRole("alert")).not.toBeInTheDocument();
        expect(alert.parentElement).toHaveClass("scroll-clear-nav");
        expect(scrolled.mock.contexts).toContain(alert.parentElement);
      } finally {
        scrolled.mockRestore();
      }
    });

    it("moves to the row of the next change that fails, and clears for one that works", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const user = userEvent.setup();
        apiFetch.mockResolvedValue(page([member("u1", "Alice"), member("u2", "Ben")]));
        render(<MemberList googleDomains={null} />);
        await screen.findByText(/^Ben/);

        apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        await user.click(within(row("Ben")).getByRole("button", { name: "Make an admin" }));
        await within(row("Ben")).findByRole("alert");
        await waitFor(() => {
          expect(within(row("Alice")).getByRole("button", { name: "Make an admin" })).toBeEnabled();
        });

        await user.click(within(row("Alice")).getByRole("button", { name: "Make an admin" }));
        const alert = await within(row("Alice")).findByRole("alert");
        expect(screen.getAllByRole("alert")).toEqual([alert]);
        expect(scrolled.mock.contexts).toEqual([
          within(row("Ben"))
            .getByRole("button", { name: "Deactivate" })
            .closest(".scroll-clear-nav"),
          alert.parentElement,
        ]);

        apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
          init?.method === "PATCH"
            ? Promise.resolve(member("u1", "Alice", { role: "admin" }))
            : Promise.resolve(
                page([member("u1", "Alice", { role: "admin" }), member("u2", "Ben")]),
              ),
        );
        await user.click(within(row("Alice")).getByRole("button", { name: "Make an admin" }));
        expect(await within(row("Alice")).findByText("Admin")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(scrolled).toHaveBeenCalledTimes(2);
      } finally {
        scrolled.mockRestore();
      }
    });
  });

  /* Every row's buttons are disabled while a change is out, and the pressed
     one loses focus to the page: a keyboard admin was left at the top of it
     (#214). Each holds the refusal past a frame, as a real one is (D-208-6). */
  describe("focus after a refused change", () => {
    async function listed() {
      apiFetch.mockResolvedValue(
        page([member("u1", "Alice"), member("u2", "Ben", { deactivated: true })]),
      );
      render(<MemberList googleDomains={null} />);
      await screen.findByText(/^Ben/);
      let refuse: (reason: unknown) => void = () => undefined;
      apiFetch.mockReturnValueOnce(
        new Promise((_, reject) => {
          refuse = reject;
        }),
      );
      return (reason: unknown) => {
        refuse(reason);
      };
    }

    it.each(["Make an admin", "Reactivate"])(
      "goes back to %s in the row pressed, before the row is brought into view",
      async (label) => {
        const focusAtScroll: (Element | null)[] = [];
        const scrolled = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {
          focusAtScroll.push(document.activeElement);
        });
        try {
          const refuse = await listed();
          const user = userEvent.setup();
          const button = within(row("Ben")).getByRole("button", { name: label });
          await user.click(button);
          expect(button).toBeDisabled();
          await nextFrame();
          expect(document.body).toHaveFocus();

          refuse(new TypeError("Failed to fetch"));
          const alert = await within(row("Ben")).findByRole("alert");
          expect(button).toHaveFocus();
          expect(alert).not.toHaveFocus();
          expect(focusAtScroll).toEqual([button]);
        } finally {
          scrolled.mockRestore();
        }
      },
    );

    it("ends on that row's Deactivate after its confirm, once the dialog has gone", async () => {
      const refuse = await listed();
      const user = userEvent.setup();
      const button = within(row("Alice")).getByRole("button", { name: "Deactivate" });
      await user.click(button);
      const dialog = screen.getByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
      await within(dialog).findByRole("button", { name: "Working…" });
      await nextFrame();
      expect(document.body).toHaveFocus();

      refuse(new TypeError("Failed to fetch"));
      await within(row("Alice")).findByRole("alert");
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
      expect(button).toHaveFocus();
    });
  });

  it("shows the new person without a manual refresh", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    render(<MemberList googleDomains={null} />);
    await screen.findByText(/^Alice/);

    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.resolve(member("u9", "New Person"))
        : Promise.resolve(page([member("u1", "Alice"), member("u9", "New Person")])),
    );
    await user.click(screen.getByRole("button", { name: "Add someone" }));
    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByText(/^New Person/)).toBeInTheDocument();
  });

  it("offers a retry when the team fails to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<MemberList googleDomains={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the team.");

    apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^Alice/)).toBeInTheDocument();
  });

  it("copes with a non-Error load failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<MemberList googleDomains={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the team.");
  });

  /* #249 */
  describe("the approval sections", () => {
    it("puts who waits for approval above Add someone, and who was turned down below the team", async () => {
      apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
      render(<MemberList googleDomains={null} />);
      await screen.findByText(/^Alice/);

      const pending = screen.getByText("pending section, version 0");
      const add = screen.getByRole("button", { name: "Add someone" });
      const blocked = screen.getByText("blocked section, version 0");
      expect(pending.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        row("Alice").compareDocumentPosition(blocked) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("shows them while the team is still loading or failed to", async () => {
      apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
      render(<MemberList googleDomains={null} />);
      expect(screen.getByText("pending section, version 0")).toBeInTheDocument();
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the team.");
      expect(screen.getByText("blocked section, version 0")).toBeInTheDocument();
    });

    it("reads the team again when someone is approved into it", async () => {
      apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
      render(<MemberList googleDomains={null} />);
      await screen.findByText(/^Alice/);

      apiFetch.mockResolvedValue(page([member("u1", "Alice"), member("u7", "Pat")]));
      act(() => {
        section("pending").onChanged("approved");
      });
      expect(await screen.findByText(/^Pat/)).toBeInTheDocument();
      expect(screen.getByText("pending section, version 0")).toBeInTheDocument();
      expect(screen.getByText("blocked section, version 0")).toBeInTheDocument();
    });

    it("has the other section read again when someone moves into it", async () => {
      apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
      render(<MemberList googleDomains={null} />);
      await screen.findByText(/^Alice/);

      act(() => {
        section("pending").onChanged("rejected");
      });
      expect(screen.getByText("blocked section, version 1")).toBeInTheDocument();
      act(() => {
        section("blocked").onChanged("unblocked");
      });
      expect(screen.getByText("pending section, version 1")).toBeInTheDocument();
      expect(screen.getByText("blocked section, version 1")).toBeInTheDocument();
      // Neither moved anyone into the team.
      expect(apiFetch).toHaveBeenCalledOnce();
    });

    it("reads all three again when a change was refused as stale", async () => {
      apiFetch.mockResolvedValue(page([member("u1", "Alice")]));
      render(<MemberList googleDomains={null} />);
      await screen.findByText(/^Alice/);

      act(() => {
        section("pending").onChanged("stale");
      });
      expect(screen.getByText("pending section, version 1")).toBeInTheDocument();
      expect(screen.getByText("blocked section, version 1")).toBeInTheDocument();
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  it("falls back to the email for somebody with no name, in the row and when deactivating", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([{ ...member("u1", "Alice"), name: null }]));
    render(<MemberList googleDomains={null} />);
    expect(await screen.findAllByText("alice@t.local")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(
      screen.getByRole("alertdialog", { name: "Deactivate alice@t.local?" }),
    ).toBeInTheDocument();
  });
});
