import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

/*
 * Like a browser, jsdom moves focus from a control that has become disabled
 * to the page at its next rendering update, which runs the animation frames
 * too (R-199). An attempt held past one frame loses focus every time, as a
 * real one does; an answer within a frame kept it, unless a busy runner drew
 * the answer late (#208).
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Clearing keeps queued once-answers: one a test left unread must not
  // answer the next test's sign-in.
  signIn.mockReset();
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
    // A refused password is never sent again by itself.
    expect(signIn).toHaveBeenCalledOnce();
    // The member can correct the password and try again.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  /* Told at the top of the form, it landed above the screen on an iPhone at
     large text (#151). jsdom lays nothing out: the E2E measures. */
  describe("bringing a refusal into view", () => {
    async function submit(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByLabelText("Email"), "a@b.c");
      await user.type(screen.getByLabelText("Password"), "wrong-password");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
    }

    it("scrolls to it as it is drawn, no further than it is hidden, leaving focus where it was", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        let refuse: (value: typeof failed) => void = () => undefined;
        signIn.mockReturnValue(
          new Promise<typeof failed>((resolve) => {
            refuse = resolve;
          }),
        );
        const user = userEvent.setup();
        render(<SignInForm />);
        // The page opens at its top.
        expect(scrolled).not.toHaveBeenCalled();
        await submit(user);
        // Disabled while the attempt is out, Sign in loses focus to the page.
        await screen.findByRole("button", { name: "Signing in…" });
        await nextFrame();
        expect(document.body).toHaveFocus();

        refuse(failed);
        const alert = await screen.findByRole("alert");
        expect(scrolled.mock.contexts).toEqual([alert]);
        expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
        expect(alert).not.toHaveFocus();
        expect(screen.getByRole("button", { name: "Sign in" })).toHaveFocus();
      } finally {
        scrolled.mockRestore();
      }
    });

    it("scrolls to the page-expired message too", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const expired = { error: "MissingCSRF", code: undefined, status: 200, ok: true, url: null };
        signIn.mockResolvedValue(expired);
        const user = userEvent.setup();
        render(<SignInForm />);
        await submit(user);

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("This page expired.");
        expect(scrolled.mock.contexts).toEqual([alert]);
      } finally {
        scrolled.mockRestore();
      }
    });

    it("leaves the page where it is as a second try clears it, and scrolls again when that one is refused", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        let release: (value: typeof failed) => void = () => undefined;
        signIn.mockResolvedValueOnce(failed).mockReturnValueOnce(
          new Promise<typeof failed>((resolve) => {
            release = resolve;
          }),
        );
        const user = userEvent.setup();
        render(<SignInForm />);
        await submit(user);
        await screen.findByRole("alert");
        expect(scrolled).toHaveBeenCalledOnce();

        // Sign in is under the thumb that just pressed it again.
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        await screen.findByRole("button", { name: "Signing in…" });
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(scrolled).toHaveBeenCalledOnce();

        release(failed);
        const alert = await screen.findByRole("alert");
        expect(scrolled).toHaveBeenCalledTimes(2);
        expect(scrolled.mock.contexts[1]).toBe(alert);
      } finally {
        scrolled.mockRestore();
      }
    });
  });

  /* A refusal puts focus back only where the browser took it from. */
  describe("where focus is once an attempt is refused (#208)", () => {
    it("stays in the password field the keyboard's Go sent it from", async () => {
      signIn.mockResolvedValue(failed);
      const user = userEvent.setup();
      render(<SignInForm />);
      await user.type(screen.getByLabelText("Email"), "a@b.c");
      await user.type(screen.getByLabelText("Password"), "wrong-password{Enter}");

      await screen.findByRole("alert");
      expect(screen.getByLabelText("Password")).toHaveFocus();
    });

    it("stays on the page when the press focused no button, as a tap on an iPhone does", async () => {
      signIn.mockResolvedValue(failed);
      const user = userEvent.setup();
      render(<SignInForm />);
      await user.type(screen.getByLabelText("Email"), "a@b.c");
      const password = screen.getByLabelText("Password");
      await user.type(password, "wrong-password");
      // WebKit takes focus from the field and gives the button none.
      password.blur();
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await screen.findByRole("alert");
      expect(document.body).toHaveFocus();
    });
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

  /* Auth.js checks the CSRF token before it reads the credentials, and names
     that refusal MissingCSRF: a cookie swapped since the token was fetched,
     or one the phone did not keep. */
  describe("when the CSRF check refuses the attempt (#151)", () => {
    const expired = { error: "MissingCSRF", code: undefined, status: 200, ok: true, url: null };

    async function submit(password: string) {
      const user = userEvent.setup();
      render(<SignInForm />);
      await user.type(screen.getByLabelText("Email"), "a@b.c");
      await user.type(screen.getByLabelText("Password"), password);
      await user.click(screen.getByRole("button", { name: "Sign in" }));
    }

    it("sends it once more, showing nothing, and signs in", async () => {
      signIn.mockResolvedValueOnce(expired).mockResolvedValueOnce(ok);
      await submit("password123");

      await waitFor(() => {
        expect(goTo).toHaveBeenCalledWith("/");
      });
      expect(signIn).toHaveBeenCalledTimes(2);
      expect(signIn.mock.calls[1]).toEqual(signIn.mock.calls[0]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("stays on Signing in, with no message, while the second go is out", async () => {
      let release: (value: typeof ok) => void = () => undefined;
      signIn.mockResolvedValueOnce(expired).mockReturnValueOnce(
        new Promise<typeof ok>((resolve) => {
          release = resolve;
        }),
      );
      await submit("password123");

      await waitFor(() => {
        expect(signIn).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      release(ok);
      await waitFor(() => {
        expect(goTo).toHaveBeenCalledWith("/");
      });
    });

    it("says the page expired when the second go is refused too, and stops there", async () => {
      signIn.mockResolvedValueOnce(expired).mockResolvedValueOnce(expired);
      await submit("password123");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This page expired. Reload it and try again.",
      );
      expect(signIn).toHaveBeenCalledTimes(2);
      expect(goTo).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    });

    it("keeps the one generic message when the second go is refused on the credentials", async () => {
      signIn.mockResolvedValueOnce(expired).mockResolvedValueOnce(failed);
      await submit("wrong-password");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Email or password is incorrect.");
      expect(alert).not.toHaveTextContent(/expired/i);
      expect(signIn).toHaveBeenCalledTimes(2);
    });
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

/* As config.yaml's auth.google.domains has them. */
const DOMAINS = ["gmail.com", "tjc.sg", "tjc.org"];

/* Google first when the server has it set up, the email form as the fallback. */
describe("SignInForm with Google (#14)", () => {
  const google = () => screen.getByRole("button", { name: "Sign in with Google" });

  it("offers Google first, then the email form under its own exact name", () => {
    render(<SignInForm googleDomains={DOMAINS} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Sign in with Google", "Sign in"]);
    // Nothing else is labelled: "Email" and "Password" each name one field.
    expect(screen.getAllByLabelText(/email|password/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass("btn-secondary");
  });

  it("is not offered while the server has no Google sign-in", () => {
    render(<SignInForm />);
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass("btn-primary");
  });

  it("leaves for Google with where the member was headed, after the clears sign-in makes", async () => {
    get.mockImplementation((key) => (key === "callbackUrl" ? "/history" : null));
    signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SignInForm googleDomains={DOMAINS} />);
    await user.click(google());

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/history" });
    });
    const leftAt = signIn.mock.invocationCallOrder[0] ?? -Infinity;
    expect(clearCaches.mock.invocationCallOrder[0]).toBeLessThan(leftAt);
    expect(clearLocalCopy.mock.invocationCallOrder[0]).toBeLessThan(leftAt);
    // A second tap while Google's page loads would start a second trip.
    expect(screen.getByRole("button", { name: "Opening Google…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("does not follow a callback to another site", async () => {
    get.mockImplementation((key) => (key === "callbackUrl" ? "//evil.example/" : null));
    signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SignInForm googleDomains={DOMAINS} />);
    await user.click(google());
    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/" });
    });
  });

  it("leaves only once the look after a sign-out is done (D-129-5)", async () => {
    let done: () => void = () => undefined;
    finishSignOut.mockReturnValue(
      new Promise<void>((resolve) => {
        done = resolve;
      }),
    );
    signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SignInForm googleDomains={DOMAINS} />);
    await user.click(google());

    expect(signIn).not.toHaveBeenCalled();
    done();
    await waitFor(() => {
      expect(signIn).toHaveBeenCalledOnce();
    });
  });

  it("still leaves when the clears fail", async () => {
    clearCaches.mockRejectedValueOnce(new Error("storage is restricted"));
    clearLocalCopy.mockRejectedValueOnce(new Error("IndexedDB is unavailable"));
    signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SignInForm googleDomains={DOMAINS} />);
    await user.click(google());
    await waitFor(() => {
      expect(signIn).toHaveBeenCalledOnce();
    });
  });

  it("says so, and lets the member try again, when it cannot leave", async () => {
    signIn.mockRejectedValue(new Error("Failed to fetch"));
    const user = userEvent.setup();
    render(<SignInForm googleDomains={DOMAINS} />);
    await user.click(google());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google sign-in didn't finish. Try again, or sign in with your email and password.",
    );
    expect(google()).toBeEnabled();
  });

  it("puts focus back on Sign in with Google when it cannot leave", async () => {
    let fail: (reason: Error) => void = () => undefined;
    signIn.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const user = userEvent.setup();
    render(<SignInForm googleDomains={DOMAINS} />);
    await user.click(google());
    await screen.findByRole("button", { name: "Opening Google…" });
    await nextFrame();
    expect(signIn).toHaveBeenCalledOnce();
    expect(document.body).toHaveFocus();

    fail(new Error("Failed to fetch"));
    await screen.findByRole("alert");
    expect(google()).toHaveFocus();
  });

  describe("back from Google with ?error=", () => {
    const withError = (error: string) => {
      get.mockImplementation((key) => (key === "error" ? error : null));
    };

    it("gives every refusal one message, whoever has an account, naming Google's domains (D-15-1)", () => {
      withError("AccessDenied");
      render(<SignInForm googleDomains={DOMAINS} />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That Google account can't sign in here. Google sign-in is for " +
          "gmail.com, tjc.sg or tjc.org addresses your admin added; otherwise, use your email and password.",
      );
    });

    it("does not scroll to it: the page opens at its top", () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        withError("AccessDenied");
        render(<SignInForm googleDomains={DOMAINS} />);
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(scrolled).not.toHaveBeenCalled();
      } finally {
        scrolled.mockRestore();
      }
    });

    it("gives anything else a message to act on, never the raw value", () => {
      withError("<b>Configuration</b>");
      render(<SignInForm googleDomains={DOMAINS} />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Google sign-in didn't finish.");
      expect(alert.textContent).not.toContain("Configuration");
    });

    it("shows nothing for it while the server has no Google sign-in", () => {
      withError("AccessDenied");
      render(<SignInForm />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("stands in for the signed-out note, then goes once the member tries again", async () => {
      get.mockImplementation((key) =>
        key === "error" ? "AccessDenied" : key === "reason" ? "signed-out" : null,
      );
      signIn.mockResolvedValue(failed);
      const user = userEvent.setup();
      render(<SignInForm googleDomains={DOMAINS} />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      await user.type(screen.getByLabelText("Email"), "a@b.c");
      await user.type(screen.getByLabelText("Password"), "wrong-password");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    });
  });
});

/*
 * The page is rendered per request, so the server's HTML holds what this
 * draws before its scripts arrive. A form there was a plain GET: Go put the
 * password in the address bar, and what was typed was emptied once live.
 */
describe("SignInForm before the page is live (D-113-6)", () => {
  it("draws Google and the server's message, but nothing to type into or send", () => {
    get.mockImplementation((key) => (key === "error" ? "AccessDenied" : null));
    const page = document.createElement("div");
    page.innerHTML = renderToString(<SignInForm googleDomains={DOMAINS} />);

    expect(page).toHaveTextContent("Sign in with Google");
    expect(page).toHaveTextContent("That Google account can't sign in here.");
    expect(page.querySelector("form")).toBeNull();
    expect(page.querySelector("input")).toBeNull();
    expect(within(page).queryByText("or")).toBeNull();
  });

  it("draws the email form once live, as the server drew the rest", async () => {
    const page = document.createElement("div");
    page.innerHTML = renderToString(<SignInForm googleDomains={DOMAINS} />);
    document.body.append(page);
    const mismatch = vi.fn();
    const root = await act(() =>
      hydrateRoot(page, <SignInForm googleDomains={DOMAINS} />, { onRecoverableError: mismatch }),
    );

    expect(mismatch).not.toHaveBeenCalled();
    expect(within(page).getByLabelText("Email")).toBeInTheDocument();
    expect(within(page).getByLabelText("Password")).toBeInTheDocument();
    expect(within(page).getByRole("button", { name: "Sign in" })).toBeEnabled();
    act(() => {
      root.unmount();
    });
    page.remove();
  });
});
