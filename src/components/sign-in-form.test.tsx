import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm, validate } from "@/components/sign-in-form";

const { signIn, push, refresh, get, clearCaches } = vi.hoisted(() => ({
  clearCaches: vi.fn(() => Promise.resolve()),
  signIn: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  get: vi.fn<(key: string) => string | null>(),
}));

vi.mock("next-auth/react", () => ({ signIn }));
vi.mock("@/lib/sw-client", () => ({ clearServiceWorkerCaches: clearCaches }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => ({ get }),
}));

const ok = { error: undefined, code: undefined, status: 200, ok: true, url: null };
const failed = { error: "CredentialsSignin", code: undefined, status: 401, ok: false, url: null };

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReturnValue(null);
});

describe("validate", () => {
  it("requires an email", () => {
    expect(validate("", "pw").email).toBe("Enter your email.");
  });

  it("requires the email to look like one", () => {
    expect(validate("not-an-email", "pw").email).toMatch(/valid email/);
  });

  it("requires a password", () => {
    expect(validate("a@b.c", "").password).toBe("Enter your password.");
  });

  it("accepts a filled form", () => {
    expect(validate("a@b.c", "password123")).toEqual({});
  });
});

describe("SignInForm", () => {
  it("shows inline errors without calling the server", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your email.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("marks invalid fields for assistive tech", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the router cache before navigating", async () => {
    /*
     * Prefetches made while signed out are redirects back to the sign-in page.
     * Pushing without invalidating them replays one, and the member is left
     * looking at the form they just completed - which is what happened in the
     * production build until the e2e suite caught it.
     */
    const user = userEvent.setup();
    signIn.mockResolvedValue(ok);
    get.mockReturnValue(null);
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      push.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("signs in and redirects home", async () => {
    signIn.mockResolvedValue(ok);
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("credentials", {
        email: "admin@example.com",
        password: "password123",
        redirect: false,
      });
    });
    expect(push).toHaveBeenCalledWith("/");
  });

  it("forgets the previous member's cached API answers on sign-in, not on failure", async () => {
    signIn.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok);
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("alert");
    expect(clearCaches).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(clearCaches).toHaveBeenCalledOnce();
    });
  });

  it("returns to where the user was headed", async () => {
    signIn.mockResolvedValue(ok);
    get.mockReturnValue("/history");
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/history");
    });
  });

  it("shows one generic message on failure", async () => {
    // Must not reveal whether the account exists.
    signIn.mockResolvedValue(failed);
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "nobody@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email or password is incorrect.");
    expect(alert.textContent).not.toMatch(/unknown|no such|deactivated|exists/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("never puts the password in the DOM as readable text", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Password"), "password123");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("disables the button while submitting", async () => {
    let release: (value: typeof ok) => void = () => undefined;
    signIn.mockReturnValue(
      new Promise<typeof ok>((resolve) => {
        release = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Otherwise a double tap on a slow connection sends two attempts.
    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
    release(ok);
  });
});
