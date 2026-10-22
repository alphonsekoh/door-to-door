import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminTeams } from "@/components/admin/admin-teams";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});
const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/use-online", () => ({ useOnline }));
vi.mock("@/lib/use-role", () => ({
  useRole: () => ({
    userId: "admin",
    role: "admin",
    isAdmin: true,
    isMember: false,
    isLoading: false,
    isSignedIn: true,
  }),
}));

const person = (id: string, name: string | null) => ({ id, name, image: null });
const account = (id: string, name: string | null) => ({
  ...person(id, name),
  email: `${id}@t.local`,
  role: id === "admin" ? "admin" : "member",
  deactivatedAt: null,
  lastRecordedAt: null,
  createdAt: "",
});
const team = (id: string, name: string, members: ReturnType<typeof person>[]) => ({
  id,
  sessionId: "s1",
  name,
  members,
  createdAt: "",
});

const ALICE = person("alice", "Alice Tan");
const BEN = person("ben", "Ben Lim");
const USERS = [
  account("admin", "Ada Admin"),
  account("alice", "Alice Tan"),
  account("ben", "Ben Lim"),
  account("cy", "Cy Ong"),
];

type World = { teams: unknown[]; users: unknown[] };
let world: World;
let writes: ((path: string, init: RequestInit) => unknown) | undefined;

const error = (status: number, code: string) =>
  new ApiRequestError(status, { error: { code, message: "server words" } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  useOnline.mockReturnValue(true);
  world = { teams: [team("t1", "Alice & Ben", [ALICE, BEN])], users: USERS };
  writes = undefined;
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method !== undefined) {
      if (writes === undefined) return Promise.reject(new Error("unexpected write"));
      return Promise.resolve(writes(path, init));
    }
    if (path === "/sessions/s1/teams") return Promise.resolve({ data: world.teams });
    if (path === "/users?limit=100&offset=0") {
      return Promise.resolve({
        data: world.users,
        pagination: { limit: 100, offset: 0, total: world.users.length, hasMore: false },
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

const writesTo = () =>
  apiFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== undefined);

function sent(index = 0): { path: string; method: string | undefined; body: unknown } {
  const call = writesTo()[index] as [string, RequestInit] | undefined;
  if (call === undefined) throw new Error("nothing was sent");
  const raw = call[1].body;
  return {
    path: call[0],
    method: call[1].method,
    body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined,
  };
}

async function teamCard(name: string): Promise<HTMLElement> {
  return screen.findByRole("listitem", { name });
}

describe("listing", () => {
  it("lists every team with its current members", async () => {
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    const card = await teamCard("Alice & Ben");
    expect(within(card).getByText("Alice Tan")).toBeInTheDocument();
    expect(within(card).getByText("Ben Lim")).toBeInTheDocument();
  });

  it("marks the admin on a team they are on", async () => {
    world.teams = [team("t1", "Supervisors", [person("admin", "Ada Admin")])];
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    expect(await screen.findByText("Ada Admin (you)")).toBeInTheDocument();
  });

  it("says so when the outing has no teams, and when a team is empty", async () => {
    world.teams = [];
    const { unmount } = render(<AdminTeams sessionId="s1" status="draft" tick={0} />);
    expect(await screen.findByText("No teams in this session.")).toBeInTheDocument();
    unmount();

    world.teams = [team("t1", "Leftovers", [])];
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    expect(await screen.findByText("Nobody is on this team now.")).toBeInTheDocument();
  });

  it("states the unsynced-records limit", async () => {
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    expect(await screen.findByText(/once they have synced/)).toBeInTheDocument();
  });

  it("re-reads when the screen's poll ticks", async () => {
    const { rerender } = render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await teamCard("Alice & Ben");
    world.teams = [team("t1", "North pair", [ALICE, BEN])];
    rerender(<AdminTeams sessionId="s1" status="active" tick={1} />);
    expect(await teamCard("North pair")).toBeInTheDocument();
  });
});

describe("forming a team", () => {
  it("places only the people chosen, never the admin unasked", async () => {
    const user = userEvent.setup();
    writes = () => team("t2", "Cy", [person("cy", "Cy Ong")]);
    render(<AdminTeams sessionId="s1" status="draft" tick={0} />);

    await user.click(await screen.findByRole("button", { name: "New team" }));
    const sheet = screen.getByRole("dialog", { name: "New team" });
    // Alice and Ben are on a team already, so only the free are offered.
    expect(within(sheet).queryByRole("button", { name: /Alice Tan/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /Cy Ong/ }));
    expect(within(sheet).getByLabelText(/Team name/)).toHaveValue("Cy");
    await user.click(within(sheet).getByRole("button", { name: "Create team" }));

    expect(sent()).toEqual({
      path: "/sessions/s1/teams",
      method: "POST",
      body: { name: "Cy", memberIds: ["cy"] },
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("adds the admin when they pick themselves, and names the team after both", async () => {
    const user = userEvent.setup();
    writes = () => team("t2", "Ada & Cy", []);
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(await screen.findByRole("button", { name: "New team" }));
    const sheet = screen.getByRole("dialog", { name: "New team" });
    await user.click(within(sheet).getByRole("button", { name: /^Ada Admin \(you\)/ }));
    await user.click(within(sheet).getByRole("button", { name: /Cy Ong/ }));
    await user.click(within(sheet).getByRole("button", { name: "Create team" }));

    expect(sent().body).toEqual({ name: "Ada & Cy", memberIds: ["admin", "cy"] });
  });

  it("offers no New team once the outing has ended, but keeps the fixes", async () => {
    render(<AdminTeams sessionId="s1" status="ended" tick={0} />);
    const card = await teamCard("Alice & Ben");
    expect(screen.queryByRole("button", { name: "New team" })).not.toBeInTheDocument();
    expect(screen.getByText(/no new team can be formed/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Rename" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Add member" })).toBeEnabled();
  });
});

describe("changing a team", () => {
  it("renames", async () => {
    const user = userEvent.setup();
    writes = () => team("t1", "North pair", [ALICE, BEN]);
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(within(await teamCard("Alice & Ben")).getByRole("button", { name: "Rename" }));
    const field = within(screen.getByRole("dialog", { name: "Rename team" })).getByLabelText(
      /Team name/,
    );
    expect(field).toHaveValue("Alice & Ben");
    await user.clear(field);
    await user.type(field, "North pair");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(sent()).toEqual({ path: "/teams/t1", method: "PATCH", body: { name: "North pair" } });
  });

  it("adds one person", async () => {
    const user = userEvent.setup();
    writes = () => team("t1", "Alice & Ben", [ALICE, BEN]);
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(
      within(await teamCard("Alice & Ben")).getByRole("button", { name: "Add member" }),
    );
    const sheet = screen.getByRole("dialog", { name: "Add to team" });
    expect(within(sheet).getByRole("button", { name: "Choose someone" })).toBeDisabled();
    await user.click(within(sheet).getByRole("button", { name: /Ada Admin/ }));
    await user.click(within(sheet).getByRole("button", { name: /Cy Ong/ }));
    await user.click(within(sheet).getByRole("button", { name: "Add to team" }));

    expect(sent()).toEqual({ path: "/teams/t1/members", method: "POST", body: { userId: "cy" } });
  });

  it("asks before removing someone and says what they lose", async () => {
    const user = userEvent.setup();
    writes = () => team("t1", "Alice & Ben", [ALICE]);
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(
      await screen.findByRole("button", { name: "Remove Ben Lim from Alice & Ben" }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Remove Ben Lim from Alice & Ben?" });
    expect(dialog).toHaveTextContent(/lose access to their teammates' records/);
    await user.click(within(dialog).getByRole("button", { name: "Remove from team" }));

    expect(sent()).toEqual({ path: "/teams/t1/members/ben", method: "DELETE", body: undefined });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("keeps everyone when the removal is cancelled", async () => {
    const user = userEvent.setup();
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await user.click(
      await screen.findByRole("button", { name: "Remove Ben Lim from Alice & Ben" }),
    );
    await user.click(screen.getByRole("button", { name: "Keep as it is" }));
    expect(writesTo()).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("deletes an empty team after asking", async () => {
    const user = userEvent.setup();
    writes = () => undefined;
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(
      within(await teamCard("Alice & Ben")).getByRole("button", { name: "Delete team" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog", { name: "Delete Alice & Ben?" })).getByRole("button", {
        name: "Delete team",
      }),
    );
    expect(sent()).toEqual({ path: "/teams/t1", method: "DELETE", body: undefined });
  });

  it("explains that a team with records cannot be deleted", async () => {
    const user = userEvent.setup();
    writes = () => {
      throw error(409, "conflict");
    };
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(
      within(await teamCard("Alice & Ben")).getByRole("button", { name: "Delete team" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete team" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This team has records and cannot be removed; remove its members instead.",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText("server words")).not.toBeInTheDocument();
  });

  it("dismisses the delete question without deleting", async () => {
    const user = userEvent.setup();
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await user.click(
      within(await teamCard("Alice & Ben")).getByRole("button", { name: "Delete team" }),
    );
    await user.click(screen.getByRole("button", { name: "Keep as it is" }));
    expect(writesTo()).toHaveLength(0);
  });

  it("sends one request for a double tap", async () => {
    let finish: () => void = () => undefined;
    writes = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Ben Lim from Alice & Ben" }));
    const confirm = screen.getByRole("button", { name: "Remove from team" });
    /* One act: no re-render between the taps, so only the ref guard holds. */
    act(() => {
      confirm.click();
      confirm.click();
    });
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(writesTo()).toHaveLength(1);
  });
});

describe("refusals and failures", () => {
  it("keeps the sheet open with the reason when someone was taken meanwhile", async () => {
    const user = userEvent.setup();
    writes = () => {
      throw error(409, "conflict");
    };
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(
      within(await teamCard("Alice & Ben")).getByRole("button", { name: "Add member" }),
    );
    const sheet = screen.getByRole("dialog", { name: "Add to team" });
    await user.click(within(sheet).getByRole("button", { name: /Cy Ong/ }));
    const reads = apiFetch.mock.calls.length;
    await user.click(within(sheet).getByRole("button", { name: "Add to team" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/already on a team/);
    // The picker reloads so the person no longer free drops out.
    await waitFor(() => {
      expect(apiFetch.mock.calls.length).toBeGreaterThan(reads + 1);
    });
  });

  it("never claims nothing changed when the connection drops", async () => {
    const user = userEvent.setup();
    writes = () => {
      throw new TypeError("Failed to fetch");
    };
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    await user.click(
      await screen.findByRole("button", { name: "Remove Ben Lim from Alice & Ben" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove from team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm. Refresh to see whether it went through.",
    );
    expect(screen.getByText("Connect to change teams")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New team" })).toBeDisabled();
  });

  it("disables every change while offline", async () => {
    useOnline.mockReturnValue(false);
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    const card = await teamCard("Alice & Ben");
    expect(screen.getByText("Connect to change teams")).toBeInTheDocument();
    for (const button of within(card).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("shows a demoted admin's refusal in words", async () => {
    const user = userEvent.setup();
    writes = () => {
      throw error(403, "forbidden");
    };
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await user.click(
      await screen.findByRole("button", { name: "Remove Ben Lim from Alice & Ben" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove from team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only an admin can change these teams.",
    );
  });

  it("stops offering changes once the sign-in has ended", async () => {
    const user = userEvent.setup();
    writes = () => {
      throw error(403, "account_deactivated");
    };
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await user.click(
      await screen.findByRole("button", { name: "Remove Ben Lim from Alice & Ben" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove from team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.getByRole("button", { name: "New team" })).toBeDisabled();
  });

  it("says so when a poll finds the sign-in gone", async () => {
    const { rerender } = render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await teamCard("Alice & Ben");
    apiFetch.mockRejectedValue(error(401, "unauthenticated"));
    rerender(<AdminTeams sessionId="s1" status="active" tick={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.getByRole("button", { name: "New team" })).toBeDisabled();
  });

  it("offers a retry when the teams cannot be read", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValueOnce(error(500, "internal_error"));
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the teams.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await teamCard("Alice & Ben")).toBeInTheDocument();
  });

  it("says offline when the read gets no answer", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You seem to be offline.");
  });

  it("drops a read overtaken by a newer one", async () => {
    let late: (value: unknown) => void = () => undefined;
    let lateFail: (error: unknown) => void = () => undefined;
    const { rerender } = render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await teamCard("Alice & Ben");

    apiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          late = resolve;
          lateFail = reject;
        }),
    );
    rerender(<AdminTeams sessionId="s1" status="active" tick={1} />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(4);
    });
    world.teams = [team("t1", "Newest", [ALICE])];
    rerender(<AdminTeams sessionId="s1" status="active" tick={2} />);
    expect(await teamCard("Newest")).toBeInTheDocument();

    await act(async () => {
      late({ data: [team("t1", "Stale", [])] });
      lateFail(new Error("late"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("listitem", { name: "Stale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("drops a failed read overtaken by a newer one", async () => {
    let lateFail: (error: unknown) => void = () => undefined;
    const { rerender } = render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await teamCard("Alice & Ben");

    apiFetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          lateFail = reject;
        }),
    );
    rerender(<AdminTeams sessionId="s1" status="active" tick={1} />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(4);
    });
    world.teams = [team("t1", "Newest", [ALICE])];
    rerender(<AdminTeams sessionId="s1" status="active" tick={2} />);
    expect(await teamCard("Newest")).toBeInTheDocument();

    await act(async () => {
      lateFail(new TypeError("Failed to fetch"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Connect to change teams")).not.toBeInTheDocument();
  });

  it("clears the reason when the sheet is closed", async () => {
    const user = userEvent.setup();
    writes = () => {
      throw error(404, "not_found");
    };
    render(<AdminTeams sessionId="s1" status="active" tick={0} />);
    await user.click(
      within(await teamCard("Alice & Ben")).getByRole("button", { name: "Add member" }),
    );
    await user.click(screen.getByRole("button", { name: /Cy Ong/ }));
    await user.click(screen.getByRole("button", { name: "Add to team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer there/);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
