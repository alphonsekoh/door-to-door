import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutingTeam } from "@/components/teams/outing-team";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { loadCurrentUser } from "@/lib/session/users";
import type * as UsersModule from "@/lib/session/users";
import { focusDropped, pressByKey } from "../../../test/focus-dropped";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});
const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));
/* The read the page shares is kept for the document, which here would be
   every test in the file: each test reads afresh unless it says otherwise. */
const { sharedCurrentUser } = vi.hoisted(() => ({ sharedCurrentUser: vi.fn() }));
vi.mock("@/lib/session/users", async (importOriginal) => ({
  ...(await importOriginal<typeof UsersModule>()),
  sharedCurrentUser,
}));

const person = (id: string, name: string | null) => ({ id, name, image: null });
const ME = { ...person("me", "Ann Tan"), role: "member" };
const participant = (id: string, name: string | null, teamId: string | null = null) => ({
  user: person(id, name),
  teamId,
  joinedAt: "",
});
const team = (name: string, members = [person("me", "Ann Tan"), person("ben", "Ben Lim")]) => ({
  id: "t1",
  sessionId: "s1",
  name,
  members,
  createdAt: "",
});

type World = { me: unknown; participants: unknown[]; teams: unknown[] };
let world: World;

/* Answers reads from `world`; writes are recorded and answered per test. */
let writes: ((path: string, init: RequestInit) => unknown) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  sharedCurrentUser.mockImplementation(() => loadCurrentUser());
  useOnline.mockReturnValue(true);
  world = { me: ME, participants: [], teams: [] };
  writes = undefined;
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method !== undefined) {
      if (writes === undefined) return Promise.reject(new Error("unexpected write"));
      return Promise.resolve(writes(path, init));
    }
    if (path === "/users/me") return Promise.resolve(world.me);
    if (path.endsWith("/participants")) return Promise.resolve({ data: world.participants });
    if (path.endsWith("/teams")) return Promise.resolve({ data: world.teams });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const writesTo = () =>
  apiFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== undefined);

type Sent = { path: string; method: string | undefined; body: unknown };
function firstWrite(): Sent {
  const call = writesTo()[0] as [string, RequestInit] | undefined;
  if (call === undefined) throw new Error("nothing was sent");
  const raw = call[1].body;
  return {
    path: call[0],
    method: call[1].method,
    body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined,
  };
}

describe("joining the outing", () => {
  it("offers Join until the caller is a participant", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByRole("button", { name: "Join this session" })).toBeEnabled();
    expect(screen.queryByText("You've joined this session")).not.toBeInTheDocument();
  });

  it("shows 'You've joined' once joined, and not the button", async () => {
    world.participants = [participant("me", "Ann Tan")];
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByText("You've joined this session")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join this session" })).not.toBeInTheDocument();
  });

  it("posts the join and then reads the participants again", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    const button = await screen.findByRole("button", { name: "Join this session" });
    writes = () => {
      world.participants = [participant("me", "Ann Tan")];
      return participant("me", "Ann Tan");
    };
    await userEvent.click(button);
    expect(await screen.findByText("You've joined this session")).toBeInTheDocument();
    expect(writesTo()[0]?.[0]).toBe("/sessions/s1/join");
  });

  it("explains a refusal because the outing ended", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    const button = await screen.findByRole("button", { name: "Join this session" });
    apiFetch.mockImplementationOnce(() =>
      Promise.reject(
        new ApiRequestError(409, { error: { code: "session_not_active", message: "x" } }),
      ),
    );
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not running/);
    expect(screen.getByRole("button", { name: "Join this session" })).toBeInTheDocument();
  });

  /* Disabled while it joins, Join loses focus to the page (#221). Held
     until it has, as a real refusal is (D-208-6). */
  it("gives focus back to Join after a refusal", async () => {
    let refuse: (reason: unknown) => void = () => undefined;
    writes = () =>
      new Promise((_, reject) => {
        refuse = reject;
      });
    const user = userEvent.setup();
    render(<OutingTeam sessionId="s1" tick={0} />);
    const button = await screen.findByRole("button", { name: "Join this session" });
    await pressByKey(user, button);
    expect(button).toBeDisabled();
    await focusDropped();

    refuse(new ApiRequestError(409, { error: { code: "session_not_active", message: "x" } }));
    const alert = await screen.findByRole("alert");
    expect(button).toHaveFocus();
    expect(alert).not.toHaveFocus();
  });
});

describe("the limit", () => {
  it("is stated under the card", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(
      await screen.findByText(
        "A teammate sees and edits your records once they have synced. A record still waiting on your phone is only on your phone.",
      ),
    ).toBeInTheDocument();
  });
});

describe("with no team", () => {
  beforeEach(() => {
    world.participants = [
      participant("me", "Ann Tan"),
      participant("ben", "Ben Lim"),
      participant("cara", "Cara Wong", "other"),
    ];
  });

  it("offers Pair up", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByRole("button", { name: "Pair up" })).toBeEnabled();
    expect(screen.getByText("You are not on a team yet.")).toBeInTheDocument();
  });

  it("lists only free participants and prefills the team name", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    expect(within(sheet).getByText("Ben Lim")).toBeInTheDocument();
    expect(within(sheet).queryByText("Cara Wong")).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Ann Tan")).not.toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    expect(within(sheet).getByLabelText(/Team name/)).toHaveValue("Ann & Ben");
  });

  it("creates the team with the partner and shows it", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    writes = () => {
      world.teams = [team("Ann & Ben")];
      world.participants = [
        participant("me", "Ann Tan", "t1"),
        participant("ben", "Ben Lim", "t1"),
      ];
      return world.teams[0];
    };
    await userEvent.click(within(sheet).getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Ann & Ben")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(firstWrite()).toMatchObject({
      path: "/sessions/s1/teams",
      body: { name: "Ann & Ben", memberIds: ["ben"] },
    });
  });

  it("keeps an edited name instead of overwriting it with the default", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    const input = within(sheet).getByLabelText(/Team name/);
    await userEvent.type(input, "Dream team");
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    expect(input).toHaveValue("Dream team");
  });

  it("keeps what was typed when the server refuses, with friendly words", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    await userEvent.type(within(sheet).getByLabelText(/Team name/), "!");
    apiFetch.mockReset();
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, { error: { code: "conflict", message: "raw" } }),
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Create team" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/already on a team/);
    expect(within(sheet).getByLabelText(/Team name/)).toHaveValue("Ann & Ben!");
    expect(within(sheet).getByRole("button", { name: /Ben Lim/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("sends one request when the button is tapped twice in one frame", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    writes = () => {
      world.teams = [team("Ann & Ben")];
      world.participants = [
        participant("me", "Ann Tan", "t1"),
        participant("ben", "Ben Lim", "t1"),
      ];
      return world.teams[0];
    };
    const create = within(sheet).getByRole("button", { name: "Create team" });
    act(() => {
      create.click();
      create.click();
    });
    expect(await screen.findByText("Ann & Ben")).toBeInTheDocument();
    expect(writesTo()).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not repeat a change started by the card itself", async () => {
    world.participants = [participant("me", "Ann Tan", "t1"), participant("ben", "Ben Lim", "t1")];
    world.teams = [team("Ann & Ben")];
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
    writes = () => {
      world.teams = [];
      world.participants = [participant("me", "Ann Tan")];
    };
    const confirm = screen.getByRole("button", { name: "Leave team" });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(await screen.findByRole("button", { name: "Pair up" })).toBeInTheDocument();
    expect(writesTo()).toHaveLength(1);
  });

  it("re-reads after a 409 so the picker drops someone no longer free", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    world.participants = [participant("me", "Ann Tan"), participant("ben", "Ben Lim", "other")];
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.reject(
          new ApiRequestError(409, { error: { code: "conflict", message: "x" } }),
        );
      }
      return Promise.resolve(
        path === "/users/me"
          ? world.me
          : { data: path.endsWith("/teams") ? world.teams : world.participants },
      );
    });
    await userEvent.click(within(sheet).getByRole("button", { name: "Create team" }));
    await within(sheet).findByRole("alert");
    await waitFor(() => {
      expect(within(sheet).queryByText("Ben Lim")).not.toBeInTheDocument();
    });
  });

  it("explains a name that cannot be shown while it is being typed", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.type(within(sheet).getByLabelText(/Team name/), "\u200b");
    expect(within(sheet).getByText(/cannot be shown/)).toBeInTheDocument();
  });

  it("puts the name above the picker so a keyboard cannot hide it", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    const name = within(sheet).getByLabelText(/Team name/);
    const pick = within(sheet).getByRole("button", { name: /Ben Lim/ });
    expect(name.compareDocumentPosition(pick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("makes an admin who forms a team part of it", async () => {
    world.me = { ...ME, role: "admin" };
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    writes = () => team("Ann & Ben");
    await userEvent.click(within(sheet).getByRole("button", { name: "Create team" }));
    await waitFor(() => {
      expect(writesTo()).toHaveLength(1);
    });
    expect(firstWrite().body).toMatchObject({ memberIds: ["me", "ben"] });
  });
});

describe("on a team", () => {
  beforeEach(() => {
    world.participants = [
      participant("me", "Ann Tan", "t1"),
      participant("ben", "Ben Lim", "t1"),
      participant("dan", "Dan Ong"),
    ];
    world.teams = [team("Ann & Ben")];
  });

  it("shows the team name and members, marking me with words", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByText("Ann & Ben")).toBeInTheDocument();
    expect(screen.getByText("Ann Tan (you)")).toBeInTheDocument();
    expect(screen.getByText("Ben Lim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pair up" })).not.toBeInTheDocument();
  });

  it("wraps a long team name rather than overflowing", async () => {
    world.teams = [team("A very long team name ".repeat(2).trim())];
    render(<OutingTeam sessionId="s1" tick={0} />);
    const name = await screen.findByText(/A very long team name/);
    expect(name.className).toContain("break-words");
  });

  it("renames the team", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const sheet = screen.getByRole("dialog", { name: "Rename team" });
    const input = within(sheet).getByLabelText(/Team name/);
    expect(input).toHaveValue("Ann & Ben");
    await userEvent.clear(input);
    await userEvent.type(input, "Doorknockers");
    writes = () => {
      world.teams = [team("Doorknockers")];
    };
    await userEvent.click(within(sheet).getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Doorknockers")).toBeInTheDocument();
    expect(firstWrite()).toMatchObject({
      path: "/teams/t1",
      method: "PATCH",
      body: { name: "Doorknockers" },
    });
  });

  it("refuses a blank or invisible name before asking the server", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const sheet = screen.getByRole("dialog", { name: "Rename team" });
    await userEvent.clear(within(sheet).getByLabelText(/Team name/));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save name" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Enter a team name.");
    expect(writesTo()).toHaveLength(0);
  });

  it("counts characters live", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
    expect(screen.getByText("9 of 60")).toBeInTheDocument();
  });

  it("adds a free participant", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add member" }));
    const sheet = screen.getByRole("dialog", { name: "Add a member" });
    expect(within(sheet).queryByLabelText(/Team name/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Ben Lim")).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: /Dan Ong/ }));
    writes = () => {
      world.teams = [team("Ann & Ben", [person("me", "Ann Tan"), person("dan", "Dan Ong")])];
    };
    await userEvent.click(within(sheet).getByRole("button", { name: "Add to team" }));
    expect(await screen.findByText("Dan Ong")).toBeInTheDocument();
    expect(firstWrite()).toMatchObject({ path: "/teams/t1/members", body: { userId: "dan" } });
  });

  it("closes the sheet and the leave prompt without sending anything", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep as it is" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(writesTo()).toHaveLength(0);
  });

  it("says when nobody is free to add", async () => {
    world.participants = [participant("me", "Ann Tan", "t1"), participant("ben", "Ben Lim", "t1")];
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add member" }));
    expect(screen.getByText(/No one is free to add/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a teammate" })).toBeDisabled();
  });

  it("asks before leaving, and leaves", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
    const dialog = screen.getByRole("alertdialog", { name: "Leave this team?" });
    expect(dialog).toHaveTextContent("Your teammates keep access to what you recorded.");
    expect(writesTo()).toHaveLength(0);

    writes = () => {
      world.teams = [team("Ann & Ben", [person("ben", "Ben Lim")])];
      world.participants = [participant("me", "Ann Tan"), participant("ben", "Ben Lim", "t1")];
    };
    await userEvent.click(within(dialog).getByRole("button", { name: "Leave team" }));
    expect(await screen.findByRole("button", { name: "Pair up" })).toBeInTheDocument();
    expect(firstWrite()).toMatchObject({ path: "/teams/t1/members/me", method: "DELETE" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the team and says why when leaving is refused", async () => {
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Promise.reject(new ApiRequestError(403, { error: { code: "forbidden", message: "x" } }))
        : Promise.resolve(
            path === "/users/me"
              ? world.me
              : { data: path.endsWith("/teams") ? world.teams : world.participants },
          ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Leave team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed/);
    expect(screen.getByText("Ann & Ben")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  /* Disabled while it leaves, as Leave is behind it, the confirm's button
     loses focus to the page (#221). Held until it has (D-208-6). */
  it("ends on Leave after its confirm is refused, once the dialog has gone", async () => {
    let refuse: (reason: unknown) => void = () => undefined;
    writes = () =>
      new Promise((_, reject) => {
        refuse = reject;
      });
    const user = userEvent.setup();
    render(<OutingTeam sessionId="s1" tick={0} />);
    const button = await screen.findByRole("button", { name: "Leave" });
    await pressByKey(user, button);
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Leave team" }));
    await within(dialog).findByRole("button", { name: "Working…" });
    await focusDropped();

    refuse(new ApiRequestError(403, { error: { code: "forbidden", message: "x" } }));
    await screen.findByRole("alert");
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(button).toHaveFocus();
  });

  it("drops the leave prompt if the team disappears underneath it", async () => {
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
    world.teams = [];
    world.participants = [participant("me", "Ann Tan")];
    // A poll lands while the prompt is open.
    view.rerender(<OutingTeam sessionId="s1" tick={1} />);
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });
});

describe("offline", () => {
  it("disables every control and says how to fix it, without sending anything", async () => {
    useOnline.mockReturnValue(false);
    world.participants = [participant("me", "Ann Tan", "t1")];
    world.teams = [team("Ann & Ben")];
    render(<OutingTeam sessionId="s1" tick={0} />);
    await screen.findByText("Ann & Ben");
    for (const name of ["Rename", "Add member", "Leave"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText("Connect to change your team")).toBeInTheDocument();
    expect(writesTo()).toHaveLength(0);
  });

  it("disables Join and Pair up", async () => {
    useOnline.mockReturnValue(false);
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByRole("button", { name: "Join this session" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pair up" })).toBeDisabled();
  });

  it("disables the sheet's action if the connection drops while it is open", async () => {
    world.participants = [participant("me", "Ann Tan"), participant("ben", "Ben Lim")];
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));

    useOnline.mockReturnValue(false);
    view.rerender(<OutingTeam sessionId="s1" tick={0} />);
    expect(within(sheet).getByRole("button", { name: "Create team" })).toBeDisabled();
    expect(within(sheet).getByText("Connect to change your team")).toBeInTheDocument();
  });

  it("treats a network failure on a change as offline and keeps the sheet", async () => {
    world.participants = [participant("me", "Ann Tan"), participant("ben", "Ben Lim")];
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({}),
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Create team" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/Could not confirm/);
    expect(within(sheet).getByRole("alert")).not.toHaveTextContent(/Nothing was changed/);
    expect(within(sheet).getByLabelText(/Team name/)).toHaveValue("Ann & Ben");
    // The card behind now reads as offline, too.
    expect(within(sheet).getByRole("button", { name: "Create team" })).toBeDisabled();
  });

  it("disables every control when a change finds the sign-in gone", async () => {
    world.participants = [participant("me", "Ann Tan"), participant("ben", "Ben Lim")];
    render(<OutingTeam sessionId="s1" tick={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair up" }));
    const sheet = screen.getByRole("dialog", { name: "Pair up" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Ben Lim/ }));
    writes = () =>
      Promise.reject(
        new ApiRequestError(401, { error: { code: "unauthenticated", message: "x" } }),
      );
    await userEvent.click(within(sheet).getByRole("button", { name: "Create team" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/Sign in again/);
    // Nothing is retried under a sign-in that has ended.
    expect(within(sheet).getByRole("button", { name: "Create team" })).toBeDisabled();
  });
});

describe("loading", () => {
  it("shows nothing until the first read lands", () => {
    apiFetch.mockReturnValue(new Promise(() => undefined));
    const { container } = render(<OutingTeam sessionId="s1" tick={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a retry when the first read fails", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "x" } }),
    );
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed/);

    apiFetch.mockReset();
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path === "/users/me" ? ME : { data: [] }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Join this session" })).toBeInTheDocument();
  });

  it("treats an unreachable first read as offline", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You seem to be offline.");
  });

  it("keeps the last good card when a refresh fails", async () => {
    world.participants = [participant("me", "Ann Tan")];
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await screen.findByText("You've joined this session");
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    view.rerender(<OutingTeam sessionId="s1" tick={1} />);
    await waitFor(() => {
      expect(screen.getByText("Connect to change your team")).toBeInTheDocument();
    });
    expect(screen.getByText("You've joined this session")).toBeInTheDocument();
  });
});

describe("coming back online", () => {
  it("re-reads at once instead of waiting for the next poll", async () => {
    useOnline.mockReturnValue(false);
    world.participants = [participant("me", "Ann Tan")];
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await screen.findByText("You've joined this session");
    world.participants = [participant("me", "Ann Tan", "t1"), participant("ben", "Ben Lim", "t1")];
    world.teams = [team("Ben & Ann")];

    useOnline.mockReturnValue(true);
    view.rerender(<OutingTeam sessionId="s1" tick={0} />);
    expect(await screen.findByText("Ben & Ann")).toBeInTheDocument();
  });

  it("keeps the card visible and disabled when the poll finds the sign-in gone", async () => {
    world.participants = [participant("me", "Ann Tan")];
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await screen.findByText("You've joined this session");
    apiFetch.mockRejectedValue(
      new ApiRequestError(401, { error: { code: "unauthenticated", message: "x" } }),
    );
    view.rerender(<OutingTeam sessionId="s1" tick={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Sign in again/);
    expect(screen.getByRole("button", { name: "Pair up" })).toBeDisabled();
  });
});

describe("refreshing", () => {
  /* The shell's account check reads the same record as the page loads. */
  it("takes its first read of the account from the page's, and asks itself on the next (#252)", async () => {
    sharedCurrentUser.mockResolvedValueOnce(ME);
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await screen.findByRole("button", { name: "Join this session" });
    expect(apiFetch).not.toHaveBeenCalledWith("/users/me");

    view.rerender(<OutingTeam sessionId="s1" tick={1} />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/users/me");
    });
    expect(sharedCurrentUser).toHaveBeenCalledOnce();
  });

  it("shows a teammate who added me when the screen re-reads", async () => {
    world.participants = [participant("me", "Ann Tan"), participant("ben", "Ben Lim")];
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await screen.findByRole("button", { name: "Pair up" });

    world.participants = [participant("me", "Ann Tan", "t1"), participant("ben", "Ben Lim", "t1")];
    world.teams = [team("Ben & Ann")];
    view.rerender(<OutingTeam sessionId="s1" tick={1} />);
    expect(await screen.findByText("Ben & Ann")).toBeInTheDocument();
  });

  it("ignores a slow read that is overtaken by a newer one", async () => {
    let releaseFirst: (value: unknown) => void = () => undefined;
    let calls = 0;
    apiFetch.mockImplementation((path: string) => {
      if (path === "/users/me") {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              releaseFirst = resolve;
            })
          : Promise.resolve(ME);
      }
      return Promise.resolve({
        data: path.endsWith("/participants") ? [participant("me", "Ann Tan")] : [],
      });
    });
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    view.rerender(<OutingTeam sessionId="s1" tick={1} />);
    await screen.findByText("You've joined this session");

    await act(async () => {
      releaseFirst({ ...ME, name: "STALE" });
      await Promise.resolve();
    });
    expect(screen.getByText("You've joined this session")).toBeInTheDocument();
  });

  it("ignores a slow failure that arrives after a newer read succeeded", async () => {
    let failFirst: (reason: unknown) => void = () => undefined;
    let calls = 0;
    apiFetch.mockImplementation((path: string) => {
      if (path === "/users/me") {
        calls += 1;
        return calls === 1
          ? new Promise((_resolve, reject) => {
              failFirst = reject;
            })
          : Promise.resolve(ME);
      }
      return Promise.resolve({ data: [] });
    });
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    view.rerender(<OutingTeam sessionId="s1" tick={1} />);
    await screen.findByRole("button", { name: "Join this session" });

    await act(async () => {
      failFirst(new TypeError("Failed to fetch"));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Join this session" })).toBeEnabled();
    expect(screen.queryByText("Connect to change your team")).not.toBeInTheDocument();
  });

  it("stops re-reading once unmounted", async () => {
    /* Only the read's timer: jsdom's frames and focus fixup run on a
       setInterval, which a fake clock would stop for the rest of the file
       (R-214). */
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const view = render(<OutingTeam sessionId="s1" tick={0} />);
    view.unmount();
    await vi.advanceTimersByTimeAsync(10);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
