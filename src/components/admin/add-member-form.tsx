"use client";

import { useState } from "react";
import type { Role, User } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import {
  inGoogleDomains,
  listDomains,
  outsideGoogleDomainsMessage,
} from "@/lib/session/google-domains";

/* Matches the contract's minLength, so a short password is refused here
   rather than after a round trip. */
const MIN_PASSWORD = 8;

/*
 * Adds somebody to the team, with an initial password or with none.
 *
 * With none they sign in with Google only (#14), offered only while Google
 * sign-in is set up (`googleDomains`, null when it is not) and only for an
 * address on one of its domains. That check is affordance: POST /users
 * refuses the same. There is no invite email in this app, so a password has
 * to be read out: it stays on screen after saving for exactly that reason -
 * a password that vanishes on success is one nobody can pass on.
 */
export function AddMemberForm({
  onAdded,
  googleDomains,
}: {
  onAdded: (user: User) => void;
  googleDomains: readonly string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* password null: the account signs in with Google only. */
  const [added, setAdded] = useState<{ email: string; password: string | null } | null>(null);

  async function save(): Promise<void> {
    if (email.trim() === "") {
      setFailure("Enter an email address.");
      return;
    }
    if (password !== "" && password.length < MIN_PASSWORD) {
      setFailure(`The password needs at least ${String(MIN_PASSWORD)} characters.`);
      return;
    }
    if (password === "") {
      if (googleDomains === null) {
        setFailure("Enter an initial password.");
        return;
      }
      if (!inGoogleDomains(email.trim(), googleDomains)) {
        setFailure(outsideGoogleDomainsMessage(googleDomains));
        return;
      }
    }

    setFailure(null);
    setSaving(true);
    try {
      const user = await apiFetch<User>("/users", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() === "" ? null : name.trim(),
          ...(password === "" ? {} : { password }),
          role,
        }),
      });
      setAdded({ email: email.trim(), password: password === "" ? null : password });
      setEmail("");
      setName("");
      setPassword("");
      setRole("member");
      setOpen(false);
      onAdded(user);
    } catch (error) {
      setFailure(failureLine(error, "Could not add that person."));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setAdded(null);
          }}
          className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          Add someone
        </button>

        {added === null ? null : added.password === null ? (
          <p role="status" className="notice-success">
            {added.email} can sign in with Google.
          </p>
        ) : (
          <p role="status" className="notice-success">
            {added.email} can sign in with <strong>{added.password}</strong>. Pass it on now — it is
            not shown again.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
      aria-label="Add someone to the team"
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      {failure === null ? null : (
        <p role="alert" className="notice-danger">
          {failure}
        </p>
      )}

      <div>
        <label htmlFor="member-email" className="mb-1 block text-body font-medium">
          Email
        </label>
        <input
          id="member-email"
          type="email"
          value={email}
          autoComplete="off"
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          className="min-h-12 field"
        />
      </div>

      <div>
        <label htmlFor="member-name" className="mb-1 block text-body font-medium">
          Name
        </label>
        <input
          id="member-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          className="min-h-12 field"
        />
      </div>

      <div>
        <label htmlFor="member-password" className="mb-1 block text-body font-medium">
          Initial password
        </label>
        {/* Deliberately not type="password": the admin is reading it out to
            somebody, and hiding it from the person setting it helps nobody. */}
        <input
          id="member-password"
          type="text"
          value={password}
          autoComplete="off"
          aria-describedby={googleDomains === null ? undefined : "member-password-hint"}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          className="min-h-12 field"
        />
        {googleDomains === null ? null : (
          <p id="member-password-hint" className="mt-1 text-caption text-foreground-muted">
            Leave empty to sign in with Google only. That works for addresses at{" "}
            {listDomains(googleDomains)}.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="member-role" className="mb-1 block text-body font-medium">
          Role
        </label>
        <select
          id="member-role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as Role);
          }}
          className="h-12 min-h-12 field"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="min-h-12 flex-1 btn-primary rounded-xl text-body font-semibold"
        >
          {saving ? "Adding…" : "Add to the team"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFailure(null);
          }}
          className="min-h-12 btn-secondary rounded-xl px-4 text-body font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
