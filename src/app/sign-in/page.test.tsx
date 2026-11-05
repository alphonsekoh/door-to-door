import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignInPage from "@/app/sign-in/page";

vi.mock("next-auth/react", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

const { connection, googleSignInEnabled } = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
  googleSignInEnabled: vi.fn(() => false),
}));
vi.mock("next/server", () => ({ connection }));
vi.mock("@/server/auth/google", () => ({ googleSignInEnabled }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sign-in page", () => {
  it("renders the heading and the form", async () => {
    render(await SignInPage());
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("says where an account comes from, since there is no self-registration", async () => {
    render(await SignInPage());
    expect(screen.getByText(/admin set up for you/i)).toBeInTheDocument();
  });

  it("is rendered per request, and offers Google only once config.yaml sets it up (#14)", async () => {
    render(await SignInPage());
    expect(connection).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();

    googleSignInEnabled.mockReturnValue(true);
    render(await SignInPage());
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
  });
});
