"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, type ComponentProps } from "react";
import { destinationAfterSignIn, goTo } from "@/lib/navigate";
import { clearServiceWorkerCaches } from "@/lib/sw-client";

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

export function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const found = validate(email, password);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    setFailure(null);
    setSubmitting(true);
    const result = await signIn("credentials", { email, password, redirect: false });

    if (result.error !== undefined) {
      setSubmitting(false);
      // Never distinguish unknown email from wrong password.
      setFailure(GENERIC_FAILURE);
      return;
    }
    /* A second member signing in on a shared phone must not read the first
       one's cached API answers. */
    await clearServiceWorkerCaches();
    /* A full load, not refresh() then push(): the router holds responses fetched
       while signed out, each a redirect back here, and the refresh of /sign-in
       could outlive the push. When that refetch failed (a dropped request, or
       the next navigation aborting it) Next fell back to a hard load of
       /sign-in, leaving a signed-in member looking at the sign-in form.
       The button stays disabled until the page goes. */
    goTo(destinationAfterSignIn(params.get("callbackUrl")));
  }

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
      className="space-y-4"
    >
      {failure ? (
        <p
          role="alert"
          className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
        >
          {failure}
        </p>
      ) : null}

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
          className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
        />
        {errors.email === undefined ? null : (
          <p id="email-error" className="mt-1 text-caption text-interest-low">
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
          className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
        />
        {errors.password === undefined ? null : (
          <p id="password-error" className="mt-1 text-caption text-interest-low">
            {errors.password}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="min-h-12 w-full rounded-lg bg-primary text-body font-medium text-primary-foreground disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
