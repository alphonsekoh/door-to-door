"use client";

import { signIn, signOut } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { destinationAfterSignIn, goTo } from "@/lib/session/navigate";
import { finishSignOut } from "@/lib/session/sign-out";
import { GOOGLE_UNFINISHED, googleSignInMessage } from "@/lib/session/sign-in-errors";
import { PAGE_EXPIRED, signInWithPassword } from "@/lib/session/password-sign-in";
import { clearLocalCopy } from "@/lib/offline/local-copy-store";
import { clearServiceWorkerCaches } from "@/lib/pwa/sw-client";
import { useLive } from "@/lib/hooks/use-live";

/* Derived from the JSX prop: React 19 deprecates the standalone FormEvent type. */
type SubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

const GENERIC_FAILURE = "Email or password is incorrect.";

type FieldErrors = { email?: string; password?: string };

export function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (email.trim() === "") {
    errors.email = "Enter your email.";
  } else if (!email.includes("@")) {
    errors.email = "Enter a valid email address.";
  }
  if (password === "") {
    errors.password = "Enter your password.";
  }
  return errors;
}

/*
 * Google first when the server has it set up (#14), with email and password
 * under it as the fallback; the form alone when it does not. The page
 * decides per request, so the right one is in the first paint, and passes
 * the domains Google sign-in is for, or null when it is not set up.
 *
 * The email form waits for the page to be live (D-113-6). In the server's
 * HTML it would be a plain GET form: Go before the scripts arrive put the
 * password in the address bar and the history, and what was typed was
 * emptied at the first tap after.
 */
export function SignInForm({ googleDomains = null }: { googleDomains?: readonly string[] | null }) {
  const params = useSearchParams();
  const live = useLive();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [freshVisit, setFreshVisit] = useState(true);
  const [stillSignedIn, setStillSignedIn] = useState(false);
  const finishing = useRef<Promise<void>>(Promise.resolve());

  /* A sign-out that just brought the member here is checked once more, as the
     answer to a request the page before sent can have signed them back in. */
  useEffect(() => {
    finishing.current = finishSignOut(signOut).catch(() => {
      setStillSignedIn(true);
    });
  }, []);

  /* Auth.js sends a Google sign-in that went wrong back here with ?error=,
     which is anyone's to write: it picks a message and is never shown. */
  const googleFailure =
    googleDomains !== null && freshVisit
      ? googleSignInMessage(params.get("error"), googleDomains)
      : null;
  const shownFailure = failure ?? googleFailure;

  /*
   * Everything the email form does before it leaves happens before leaving
   * for Google instead: the way back from Google lands on the app, not here.
   */
  async function onGoogle() {
    setFreshVisit(false);
    setFailure(null);
    setLeaving(true);
    await finishing.current;
    await clearServiceWorkerCaches().catch(() => undefined);
    await clearLocalCopy().catch(() => undefined);
    try {
      await signIn("google", { redirectTo: destinationAfterSignIn(params.get("callbackUrl")) });
    } catch {
      setLeaving(false);
      setFailure(GOOGLE_UNFINISHED);
    }
  }

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const found = validate(email, password);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    setFreshVisit(false);
    setFailure(null);
    setSubmitting(true);
    /* So that check's own sign-out cannot land after this sign-in. */
    await finishing.current;
    const outcome = await signInWithPassword(signIn, email, password);

    if (outcome !== "signed-in") {
      setSubmitting(false);
      // Never distinguish unknown email from wrong password. An expired page
      // is the CSRF check alone, which reads no credentials.
      setFailure(outcome === "expired" ? PAGE_EXPIRED : GENERIC_FAILURE);
      return;
    }
    /* A second member signing in on a shared phone must not read the first
       one's cached API answers. A failed clear still lets them in, as on
       sign-out (D-74-9): the session is already set, and a rejection here
       would leave the button disabled with nothing to say why. */
    await clearServiceWorkerCaches().catch(() => undefined);
    /* Nor record offline with the first one's blocks. Their queued records
       are another store and stay: unsent ones to send when they are back
       (D-33-1), sent ones until that member signs out or 24 h pass. */
    await clearLocalCopy().catch(() => undefined);
    /* A full load, not refresh() then push(): the router holds responses fetched
       while signed out, each a redirect back here, and the refresh of /sign-in
       could outlive the push. When that refetch failed (a dropped request, or
       the next navigation aborting it) Next fell back to a hard load of
       /sign-in, leaving a signed-in member looking at the sign-in form.
       The button stays disabled until the page goes. */
    goTo(destinationAfterSignIn(params.get("callbackUrl")));
  }

  return (
    <div className="space-y-4">
      {stillSignedIn ? (
        <p role="alert" className="notice-danger">
          You may still be signed in on this phone. Check your connection, then sign in and sign out
          again.
        </p>
      ) : null}
      {params.get("reason") === "signed-out" && shownFailure === null && !stillSignedIn ? (
        <p role="status" className="rounded-lg border border-border bg-surface px-3 py-2 text-body">
          You were signed out. Sign in again to continue.
        </p>
      ) : null}
      {shownFailure === null ? null : (
        <p role="alert" className="notice-danger">
          {shownFailure}
        </p>
      )}

      {googleDomains === null ? null : (
        <button
          type="button"
          disabled={leaving || submitting}
          onClick={() => void onGoogle()}
          className="flex min-h-12 w-full btn-primary items-center justify-center gap-3 rounded-lg px-3 text-body font-medium"
        >
          {/* Google's own colours, on a chip in the button's text colour so
              its blue never sits on ours. */}
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-foreground">
            <span aria-hidden="true" className="size-4.5 google-mark" />
          </span>
          {leaving ? "Opening Google…" : "Sign in with Google"}
        </button>
      )}

      {live ? (
        <>
          {googleDomains === null ? null : (
            <p
              aria-hidden="true"
              className="flex items-center gap-3 text-caption text-foreground-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
            >
              or
            </p>
          )}
          <form
            onSubmit={(event) => {
              void onSubmit(event);
            }}
            noValidate
            className="space-y-4"
          >
            <div>
              <label htmlFor="email" className="mb-1 block text-body font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                aria-invalid={errors.email !== undefined}
                aria-describedby={errors.email === undefined ? undefined : "email-error"}
                className="min-h-12 field"
              />
              {errors.email === undefined ? null : (
                <p id="email-error" className="mt-1 field-error">
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-body font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                aria-invalid={errors.password !== undefined}
                aria-describedby={errors.password === undefined ? undefined : "password-error"}
                className="min-h-12 field"
              />
              {errors.password === undefined ? null : (
                <p id="password-error" className="mt-1 field-error">
                  {errors.password}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || leaving}
              className={`min-h-12 w-full rounded-lg text-body font-medium ${
                googleDomains === null ? "btn-primary" : "btn-secondary"
              }`}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
