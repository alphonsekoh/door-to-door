import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm, validate } from "@/components/account/sign-in-form";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { sharedQueue } from "@/lib/sync/idb-queue";
import type { QueuedVisit } from "@/lib/sync/types";

const { signIn, signOut, finishSignOut, goTo, get, clearCaches, clearLocalCopy } = vi.hoisted(
  () => ({
    clearCaches: vi.fn(() => Promise.resolve()),
    clearLocalCopy: vi.fn(() => Promise.resolve()),
    signIn: vi.fn(),
    signOut: vi.fn(),
    finishSignOut: vi.fn<() => Promise<void>>(),
    goTo: vi.fn(),
    get: vi.fn<(key: string) => string | null>(),
  }),
);

vi.mock("next-auth/react", () => ({ signIn, signOut }));
vi.mock("@/lib/session/sign-out", () => ({ finishSignOut }));
vi.mock("@/lib/pwa/sw-client", () => ({ clearServiceWorkerCaches: clearCaches }));
vi.mock("@/lib/offline/local-copy-store", () => ({ clearLocalCopy }));
vi.mock(import("@/lib/session/navigate"), async (importOriginal) => ({
  ...(await importOriginal()),
  goTo,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get }),
}));

const ok = { error: undefined, code: undefined, status: 200, ok: true, url: null };
const failed = { error: "CredentialsSignin", code: undefined, status: 401, ok: false, url: null };

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReturnValue(null);
  finishSignOut.mockResolvedValue(undefined);
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

  it("leaves by a full page load, after forgetting the cached answers", async () => {
    /*
     * The router holds prefetches made while signed out, each a redirect back
     * to sign-in. refresh() then push() cleared them, but the refresh of
     * /sign-in could outlive the push and, if it failed, Next hard-loaded
     * /sign-in over the home screen. A full load has neither problem.
     */
    const user = userEvent.setup();
    signIn.mockResolvedValue(ok);
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledOnce();
    });
    expect(clearCaches.mock.invocationCallOrder[0]).toBeLessThan(
      goTo.mock.invocationCallOrder[0] ?? -Infinity,
    );
    // A second tap while the next page loads would sign in twice.
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
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
    expect(goTo).toHaveBeenCalledWith("/");
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

  it("leaves every queued record on the phone, sent ones too, whoever saved them", async () => {
    // A sent record goes with its own member's sign-out, or after 24 h; the
    // member signing in may be the one who saved it (D-129-6).
    const queue = await sharedQueue();
    if (queue === null) throw new Error("IndexedDB did not open");
    const saved = (ownerId: string, unitNumber: string): QueuedVisit =>
      buildQueuedVisit(
        {
          blockId: "0190a000-0000-7000-8000-0000000000bb",
          unitNumber,
          interestLevel: "high",
          description: "Asked us back on Sunday",
          name: "Mr Tan",
          contact: "91234567",
          religion: "",
          sessionId: "0190a000-0000-7000-8000-0000000000cc",
        },
        ownerId,
        Date.now(),
      );
    const sent = (ownerId: string, unitNumber: string): QueuedVisit => ({
      ...saved(ownerId, unitNumber),
      state: "synced",
      syncedAt: Date.now(),
    });
    await queue.putMany([sent("ann", "#01-01"), sent("ben", "#01-02"), saved("ann", "#02-01")]);
    signIn.mockResolvedValue(ok);
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith("/");
    });

    expect((await queue.listAll()).map((r) => r.item.unitNumber).sort()).toEqual([
      "#01-01",
      "#01-02",
      "#02-01",
    ]);
  });

  it("still leaves when the cached answers cannot be cleared", async () => {
    signIn.mockResolvedValue(ok);
    clearCaches.mockRejectedValueOnce(new Error("storage is restricted"));
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith("/");
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
      expect(goTo).toHaveBeenCalledWith("/history");
    });
  });

  it("does not follow a callback to another site", async () => {
    signIn.mockResolvedValue(ok);
    get.mockReturnValue("//evil.example/");
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith("/");
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
    expect(goTo).not.toHaveBeenCalled();
    // The member can correct the password and try again.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
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

  describe("after the app signed the member out", () => {
    it("says why they are here", () => {
      get.mockImplementation((key) => (key === "reason" ? "signed-out" : null));
      render(<SignInForm />);
      // A status, not an alert: nothing went wrong on this page.
      expect(screen.getByRole("status")).toHaveTextContent(
        "You were signed out. Sign in again to continue.",
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says nothing for an ordinary visit or another reason", () => {
      render(<SignInForm />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      get.mockImplementation((key) => (key === "reason" ? "something-else" : null));
      render(<SignInForm />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("gives way to a failed attempt, so only one message shows", async () => {
      const user = userEvent.setup();
      get.mockImplementation((key) => (key === "reason" ? "signed-out" : null));
      signIn.mockResolvedValue(failed);
      render(<SignInForm />);
      await user.type(screen.getByLabelText("Email"), "a@b.c");
      await user.type(screen.getByLabelText("Password"), "wrong-password");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  /* An answer to a request the page before sent can land while this page
     loads and put the session cookie back (#129). */
  describe("on arriving from a sign-out", () => {
    it("looks once more, with Auth.js's own sign-out to hand", () => {
      render(<SignInForm />);
      expect(finishSignOut).toHaveBeenCalledExactlyOnceWith(signOut);
    });

    it("warns, rather than saying they were signed out, when the session will not go", async () => {
      get.mockImplementation((key) => (key === "reason" ? "signed-out" : null));
      finishSignOut.mockRejectedValue(new Error("The session came back after signing out"));
      render(<SignInForm />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You may still be signed in on this phone. Check your connection, then sign in and sign out again.",
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("signs in only once that look is done, so its sign-out cannot land after", async () => {
      let done: () => void = () => undefined;
      finishSignOut.mockReturnValue(
        new Promise<void>((resolve) => {
          done = resolve;
        }),
      );
      signIn.mockResolvedValue(ok);
      const user = userEvent.setup();
      render(<SignInForm />);

      await user.type(screen.getByLabelText("Email"), "a@b.c");
      await user.type(screen.getByLabelText("Password"), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
      expect(signIn).not.toHaveBeenCalled();
      done();
      await waitFor(() => {
        expect(goTo).toHaveBeenCalledWith("/");
      });
      expect(signIn).toHaveBeenCalledOnce();
    });

    it("still signs in after a look that failed", async () => {
      finishSignOut.mockRejectedValue(new Error("offline"));
      signIn.mockResolvedValue(ok);
      const user = userEvent.setup();
      render(<SignInForm />);
      await screen.findByRole("alert");

      await user.type(screen.getByLabelText("Email"), "a@b.c");
      await user.type(screen.getByLabelText("Password"), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(goTo).toHaveBeenCalledWith("/");
      });
    });
  });

  /* The offline shell must never offer the previous member's blocks (#77).
     Their queued records are another database and are not touched. */
  it("forgets the previous member's offline copy on sign-in, not on failure", async () => {
    signIn.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok);
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("alert");
    expect(clearLocalCopy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(goTo).toHaveBeenCalledOnce();
    });
    expect(clearLocalCopy).toHaveBeenCalledOnce();
    expect(clearLocalCopy.mock.invocationCallOrder[0]).toBeLessThan(
      goTo.mock.invocationCallOrder[0] ?? -Infinity,
    );
  });

  it("still leaves when the offline copy cannot be cleared", async () => {
    signIn.mockResolvedValue(ok);
    clearLocalCopy.mockRejectedValueOnce(new Error("IndexedDB is unavailable"));
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "a@b.c");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith("/");
    });
  });
});
