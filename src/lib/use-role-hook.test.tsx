import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { accountStore } from "@/lib/account-state";
import { useRole } from "@/lib/use-role";

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession }));

function Probe() {
  const { userId, role, isAdmin, isMember, isLoading, isSignedIn } = useRole();
  return (
    <ul>
      <li>id:{userId ?? "none"}</li>
      <li>role:{role ?? "none"}</li>
      <li>admin:{String(isAdmin)}</li>
      <li>member:{String(isMember)}</li>
      <li>loading:{String(isLoading)}</li>
      <li>signedIn:{String(isSignedIn)}</li>
    </ul>
  );
}

describe("useRole", () => {
  it("reads an admin from the session", () => {
    useSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "u1", role: "admin", deactivated: false } },
    });
    render(<Probe />);
    expect(screen.getByText("admin:true")).toBeInTheDocument();
    expect(screen.getByText("role:admin")).toBeInTheDocument();
    expect(screen.getByText("id:u1")).toBeInTheDocument();
  });

  it("reads a member from the session", () => {
    useSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "u2", role: "member", deactivated: false } },
    });
    render(<Probe />);
    expect(screen.getByText("member:true")).toBeInTheDocument();
    expect(screen.getByText("admin:false")).toBeInTheDocument();
  });

  it("reports loading while the session resolves", () => {
    useSession.mockReturnValue({ status: "loading", data: undefined });
    render(<Probe />);
    expect(screen.getByText("loading:true")).toBeInTheDocument();
    expect(screen.getByText("admin:false")).toBeInTheDocument();
  });

  it("reports nobody when signed out", () => {
    useSession.mockReturnValue({ status: "unauthenticated", data: null });
    render(<Probe />);
    expect(screen.getByText("signedIn:false")).toBeInTheDocument();
    expect(screen.getByText("role:none")).toBeInTheDocument();
  });

  it("drops the Admin role as soon as /users/me says it is gone", () => {
    // The token still says admin; D-74-6 means it cannot be told otherwise.
    useSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "u9", role: "admin", deactivated: false } },
    });
    render(<Probe />);
    expect(screen.getByText("admin:true")).toBeInTheDocument();

    act(() => {
      accountStore.noteCurrentUser({ id: "u9", role: "member" });
    });
    expect(screen.getByText("admin:false")).toBeInTheDocument();
    expect(screen.getByText("role:member")).toBeInTheDocument();
  });

  it("uses the token's role in the server render, so hydration matches", () => {
    accountStore.noteCurrentUser({ id: "u7", role: "member" });
    useSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "u7", role: "admin", deactivated: false } },
    });
    expect(renderToString(<Probe />)).toContain("admin:<!-- -->true");
  });
});
