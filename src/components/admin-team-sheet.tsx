"use client";

import { useRef, useState } from "react";
import type { UserSummary } from "@/generated/types.gen";
import { nameLength } from "@/lib/own-name";
import { MAX_TEAM_NAME_LENGTH, checkTeamName } from "@/lib/team-name";
import {
  ADMIN_OFFLINE_NOTE,
  describeAdminTeamFailure,
  displayName,
  suggestTeamName,
} from "@/lib/team-ui";

export type AdminTeamSheetMode = "create" | "add" | "rename";

export type AdminTeamSubmit = { name: string; memberIds: string[] };

const TITLE = { create: "New team", add: "Add to team", rename: "Rename team" } as const;
const ACTION = { create: "Create team", add: "Add to team", rename: "Save name" } as const;
const CHOOSE = { create: "Choose who is on it", add: "Choose someone", rename: "" } as const;

/*
 * The admin's way to form, rename and fill a team. Unlike the member's sheet,
 * a new team may take several people at once, and the admin is on it only if
 * they pick themselves (D-74-15, D-74-40). The name field sits above the
 * picker so the keyboard never hides it under the sticky button (D-74-47).
 */
export function AdminTeamSheet({
  mode,
  initialName,
  candidates,
  meId,
  canChange,
  onSubmit,
  onClose,
}: {
  mode: AdminTeamSheetMode;
  initialName: string;
  candidates: UserSummary[];
  meId: string | undefined;
  canChange: boolean;
  onSubmit: (submit: AdminTeamSubmit) => Promise<void>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  const showPicker = mode !== "rename";
  const showName = mode !== "add";
  const picked = candidates.filter((user) => chosen.includes(user.id));

  /* Follows the people chosen until the admin types a name of their own. */
  const name =
    typedName ??
    (mode === "create"
      ? picked.length === 0
        ? ""
        : suggestTeamName(picked.map((u) => u.name))
      : initialName);
  const nameCheck = checkTeamName(name);
  const needsPeople = showPicker && chosen.length === 0;

  function toggle(id: string): void {
    setChosen((current) => {
      if (mode === "add") return [id];
      return current.includes(id) ? current.filter((each) => each !== id) : [...current, id];
    });
  }

  async function submit(): Promise<void> {
    if (sending.current) return;
    if (showName && !nameCheck.ok) {
      setFailure(nameCheck.message);
      return;
    }
    setFailure(null);
    sending.current = true;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), memberIds: chosen });
    } catch (error) {
      setFailure(describeAdminTeamFailure(error, mode).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[mode]}
        className="max-h-[85dvh] scroll-pb-28 overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pt-4 inset-safe-bottom"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-title font-semibold">{TITLE[mode]}</p>
          <button type="button" onClick={onClose} className="min-h-11 text-body text-primary">
            Cancel
          </button>
        </div>

        {failure === null ? null : (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
          >
            {failure}
          </p>
        )}

        {showName ? (
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <label htmlFor="admin-team-name" className="text-body font-medium">
                Team name
              </label>
              <span className="text-caption text-foreground-muted">
                {String(nameLength(name.trim()))} of {String(MAX_TEAM_NAME_LENGTH)}
              </span>
            </div>
            <input
              id="admin-team-name"
              value={name}
              onChange={(event) => {
                setTypedName(event.target.value);
              }}
              className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
            />
            {name.trim() !== "" && !nameCheck.ok ? (
              <p className="mt-1 text-caption text-foreground-muted">{nameCheck.message}</p>
            ) : null}
          </div>
        ) : null}

        {showPicker ? (
          candidates.length === 0 ? (
            <p className="mt-3 text-body text-foreground-muted">
              Everyone active is already on a team in this outing.
            </p>
          ) : (
            <ul
              aria-label="People"
              className="mt-3 overflow-hidden rounded-xl border border-border bg-surface"
            >
              {candidates.map((user) => {
                const on = chosen.includes(user.id);
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        toggle(user.id);
                      }}
                      className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-border px-4 py-2 text-left last:border-b-0"
                    >
                      <span className="min-w-0 text-body font-medium break-words">
                        {displayName(user.name)}
                        {user.id === meId ? " (you)" : ""}
                      </span>
                      <span className="shrink-0 text-body font-medium text-primary">
                        {on ? "Selected" : "Select"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        <div className="sticky bottom-0 -mx-4 mt-4 bg-background/95 px-4 py-3 backdrop-blur">
          {canChange ? null : (
            <p className="mb-2 text-center text-caption text-foreground-muted">
              {ADMIN_OFFLINE_NOTE}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !canChange || needsPeople}
            onClick={() => void submit()}
            className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Saving…" : needsPeople ? CHOOSE[mode] : ACTION[mode]}
          </button>
        </div>
      </div>
    </div>
  );
}
