"use client";

import { useCallback, useEffect, useState } from "react";
import { AddMemberForm } from "@/components/add-member-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { User, UserList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { useRole } from "@/lib/use-role";
import { formatDay } from "@/lib/dates";
import { SheetPresence } from "@/components/sheet";

const PAGE_SIZE = 100;

type State =
  { status: "loading" } | { status: "ready"; users: User[] } | { status: "error"; message: string };

export function lastActiveLabel(lastRecordedAt: string | null): string {
  if (lastRecordedAt === null) {
    // Worth spotting: an account that was made and never used.
    return "never recorded";
  }
  return `last recorded ${formatDay(lastRecordedAt)}`;
}

export function MemberList() {
  const { userId } = useRole();
  const [state, setState] = useState<State>({ status: "loading" });
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      /* Deactivated people are shown here on purpose: this is the screen for
         putting somebody back, and a list that hides them cannot do that. */
      const page = await apiFetch<UserList>(
        `/users?limit=${String(PAGE_SIZE)}&includeDeactivated=true`,
      );
      setState({ status: "ready", users: page.data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load the team.",
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  async function change(user: User, body: Record<string, unknown>): Promise<void> {
    setFailure(null);
    setBusy(true);
    try {
      await apiFetch(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setDeactivating(null);
      await load();
    } catch (error) {
      /* The server refuses self-demotion and self-deactivation. Showing its
         message keeps one rule in one place rather than two that can drift. */
      setFailure(error instanceof Error ? error.message : "Could not make that change.");
      setDeactivating(null);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
        <p className="text-body">{state.message}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AddMemberForm onAdded={() => void load()} />

      {failure === null ? null : (
        <p role="alert" className="notice-danger">
          {failure}
        </p>
      )}

      <ul className="space-y-2">
        {state.users.map((user) => {
          const isSelf = user.id === userId;
          const deactivated = user.deactivatedAt !== null;
          return (
            <li key={user.id} className="rounded-xl border border-border bg-surface p-4">
              {/* At large text the role drops under the name rather than cut
                  the name and email to a few letters, which made two people
                  called Tan hard to tell apart. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 flex-[1_1_12ch]">
                  <span className="block truncate text-body font-semibold">
                    {user.name ?? user.email}
                    {isSelf ? <span className="text-foreground-muted"> (you)</span> : null}
                  </span>
                  <span className="block truncate text-caption text-foreground-muted">
                    {user.email}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-md border px-2 py-0.5 text-caption font-medium ${
                    deactivated
                      ? "border-interest-none bg-interest-none/15"
                      : "border-interest-high bg-interest-high/20"
                  }`}
                >
                  {deactivated ? "Deactivated" : user.role === "admin" ? "Admin" : "Member"}
                </span>
              </div>

              <p className="mt-1 text-caption text-foreground-muted">
                {lastActiveLabel(user.lastRecordedAt)}
              </p>

              {/*
                Both controls are hidden on your own row. The server refuses
                either move anyway - this only saves an admin discovering the
                rule by tripping over it.
              */}
              {isSelf ? (
                <p className="mt-3 text-caption text-foreground-muted">
                  You cannot change your own role or deactivate yourself.
                </p>
              ) : (
                /* Side by side while both labels fit on a line; at large text
                   they stack rather than wrap a word a line. */
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void change(user, { role: user.role === "admin" ? "member" : "admin" })
                    }
                    className="min-h-11 min-w-fit flex-1 btn-secondary rounded-lg px-3 text-body font-medium"
                  >
                    {user.role === "admin" ? "Make a member" : "Make an admin"}
                  </button>

                  {deactivated ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void change(user, { deactivated: false })}
                      className="min-h-11 min-w-fit flex-1 btn-secondary rounded-lg px-3 text-body font-medium"
                    >
                      Reactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDeactivating(user);
                      }}
                      className="min-h-11 min-w-fit flex-1 btn-secondary rounded-lg px-3 text-body font-medium"
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <SheetPresence>
        {deactivating === null ? null : (
          <ConfirmDialog
            title={`Deactivate ${deactivating.name ?? deactivating.email}?`}
            detail="They will not be able to sign in. Everything they recorded stays, and stays attributed to them."
            confirmLabel="Deactivate"
            busy={busy}
            onConfirm={() => void change(deactivating, { deactivated: true })}
            onCancel={() => {
              setDeactivating(null);
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}
