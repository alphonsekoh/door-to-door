import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignInPage from "@/app/sign-in/page";

vi.mock("next-auth/react", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
const { connection, googleDomains, error } = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
  googleDomains: vi.fn<() => readonly string[] | null>(),
  error: { value: null as string | null },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === "error" ? error.value : null) }),
}));
vi.mock("next/server", () => ({ connection }));
vi.mock("@/auth/google", () => ({ googleDomains }));

beforeEach(() => {
  vi.clearAllMocks();
  googleDomains.mockReturnValue(null);
  error.value = null;
});

describe("sign-in page", () => {
  it("renders the heading and the form", async () => {
    render(await SignInPage());
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("says where an account comes from: an admin, with no Google sign-in", async () => {
    render(await SignInPage());
    expect(screen.getByText("Use the account your admin set up for you.")).toBeInTheDocument();
  });

  it("says a newcomer signs in with Google and waits for an admin, once Google is set up (#249)", async () => {
    googleDomains.mockReturnValue(["gmail.com"]);
    render(await SignInPage());
    expect(
      screen.getByText("New here? Sign in with Google, then an admin approves you."),
    ).toBeInTheDocument();
  });

  it("is rendered per request, and offers Google only once config.yaml sets it up (#14)", async () => {
    render(await SignInPage());
    expect(connection).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();

    googleDomains.mockReturnValue(["gmail.com"]);
    render(await SignInPage());
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
  });

  it("names the domains config.yaml gives Google when Google refuses someone (#14)", async () => {
    googleDomains.mockReturnValue(["gmail.com", "tjc.sg"]);
    error.value = "AccessDenied";
    render(await SignInPage());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google sign-in is for gmail.com or tjc.sg accounts;",
    );
  });
});
