import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { accountStore } from "@/lib/session/account-state";
import { useRole } from "@/lib/hooks/use-role";
import { landWhileTyping } from "../../../test/land-while-typing";

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

  /* The shell asks /users/me once the session is known, so on weak signal it
     answers just after the block screen's own first answers, and WebKit can
     run it inside the event of text landing in the unit field (#155). One
     that agrees with the token must draw nothing, or the field's every
     reader puts back the unit it still holds. */
  it("keeps a unit typed as a /users/me that agrees with the token lands", async () => {
    useSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "u5", role: "member", deactivated: false } },
    });
    function UnitField() {
      const { role } = useRole();
      const [unit, setUnit] = useState("#05-123");
      return (
        <>
          <input
            aria-label="Unit number"
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value);
            }}
          />
          <p>role:{role}</p>
        </>
      );
    }
    render(<UnitField />);
    const field = screen.getByLabelText<HTMLInputElement>("Unit number");

    await landWhileTyping(field, "#09-999", () => {
      accountStore.noteCurrentUser({ id: "u5", role: "member" });
    });

    expect(accountStore.getSnapshot().serverUser).toEqual({ id: "u5", role: "member" });
    expect(field).toHaveValue("#09-999");
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
