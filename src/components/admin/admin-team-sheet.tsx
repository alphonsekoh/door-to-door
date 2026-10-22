"use client";

import { useRef, useState } from "react";
import type { UserSummary } from "@/generated/types.gen";
import { nameLength } from "@/lib/session/own-name";
import { MAX_TEAM_NAME_LENGTH, checkTeamName } from "@/lib/teams/team-name";
import {
  ADMIN_OFFLINE_NOTE,
  describeAdminTeamFailure,
  displayName,
  suggestTeamName,
} from "@/lib/teams/team-ui";
import { Sheet, SheetActions } from "@/components/ui/sheet";

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
  /* In the order they were tapped, so the name reads as the admin chose. */
  const picked = chosen.flatMap((id) => candidates.filter((user) => user.id === id));

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
    <Sheet label={TITLE[mode]} title={TITLE[mode]} onClose={onClose}>
      {failure === null ? null : (
        <p role="alert" className="mt-3 notice-danger">
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
            className="min-h-12 field"
          />
          {name.trim() !== "" && !nameCheck.ok ? (
            <p className="mt-1 text-caption text-foreground-muted">{nameCheck.message}</p>
          ) : null}
        </div>
      ) : null}

      {showPicker ? (
        candidates.length === 0 ? (
          <p className="mt-3 text-body text-foreground-muted">
            Everyone active is already on a team in this session.
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
                    className="flex min-h-14 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border press-row px-4 py-2 text-left last:border-b-0"
                  >
                    <span className="min-w-0 flex-[1_1_12ch] text-body font-medium break-words">
                      {displayName(user.name)}
                      {user.id === meId ? " (you)" : ""}
                    </span>
                    <span className="ml-auto shrink-0 text-body font-medium text-primary">
                      {on ? "Selected" : "Select"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      <SheetActions>
        {canChange ? null : (
          <p className="mb-2 text-center text-caption text-foreground-muted">
            {ADMIN_OFFLINE_NOTE}
          </p>
        )}
        <button
          type="button"
          disabled={busy || !canChange || needsPeople}
          onClick={() => void submit()}
          className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
        >
          {busy ? "Saving…" : needsPeople ? CHOOSE[mode] : ACTION[mode]}
        </button>
      </SheetActions>
    </Sheet>
  );
}
