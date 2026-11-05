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

  it("shows the server's reason when it refuses", async () => {
    const user = userEvent.setup();
    serve(alice, [signIn("s1", "Chrome on Android")], () =>
      Promise.reject(new Error("You do not have access to this.")),
    );
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");
    await user.click(screen.getByRole("button", { name: /^Sign out Chrome/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have access to this.");
  });

  it("copes with a refusal that is not an Error", async () => {
    const user = userEvent.setup();
    serve(alice, [signIn("s1", "Chrome on Android")], vi.fn().mockRejectedValue("boom"));
    render(<MemberDetail userId="u1" />);
    await screen.findByText("Chrome on Android");
    await user.click(screen.getByRole("button", { name: /^Sign out Chrome/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign that out.");
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
    apiFetch.mockRejectedValueOnce(new Error("No such user."));
    render(<MemberDetail userId="u1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No such user.");
    serve(alice, []);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Alice" })).toBeInTheDocument();
  });

  it("copes with a load failure that is not an Error", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<MemberDetail userId="u1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this member.");
  });
});
