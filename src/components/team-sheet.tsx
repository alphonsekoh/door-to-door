"use client";

import { useRef, useState } from "react";
import type { Participant } from "@/generated/types.gen";
import { MAX_TEAM_NAME_LENGTH, checkTeamName } from "@/lib/team-name";
import { nameLength } from "@/lib/own-name";
import { OFFLINE_NOTE, defaultTeamName, describeTeamFailure, displayName } from "@/lib/team-ui";

export type TeamSheetMode = "create" | "add" | "rename";

export type TeamSheetSubmit = { name: string; partnerId: string };

const TITLE = { create: "Pair up", add: "Add a member", rename: "Rename team" } as const;
const ACTION = { create: "Create team", add: "Add to team", rename: "Save name" } as const;

/*
 * One sheet for the three ways a team changes. The typed name and the chosen
 * person survive a failed request: a refusal must not cost anyone their input.
 */
export function TeamSheet({
  mode,
  myName,
  initialName,
  candidates,
  canChange,
  onSubmit,
  onClose,
}: {
  mode: TeamSheetMode;
  myName: string | null;
  initialName: string;
  candidates: Participant[];
  canChange: boolean;
  onSubmit: (submit: TeamSheetSubmit) => Promise<void>;
  onClose: () => void;
}) {
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request. */
  const sending = useRef(false);

  const showPicker = mode !== "rename";
  const showName = mode !== "add";
  const partner = candidates.find(({ user }) => user.id === partnerId);

  /* Follows the chosen partner until the person types their own. */
  const name =
    typedName ??
    (mode === "create" && partner ? defaultTeamName(myName, partner.user.name) : initialName);

  const needsPartner = showPicker && partner === undefined;
  const nameLengthNow = nameLength(name.trim());

  const nameCheck = checkTeamName(name);

  async function submit(): Promise<void> {
    if (sending.current) return;
    if (showName) {
      const checked = checkTeamName(name);
      if (!checked.ok) {
        setFailure(checked.message);
        return;
      }
    }
    setFailure(null);
    sending.current = true;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), partnerId: partnerId ?? "" });
    } catch (error) {
      setFailure(describeTeamFailure(error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const label = needsPartner ? "Choose a teammate" : ACTION[mode];

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
              <label htmlFor="team-name" className="text-body font-medium">
                Team name
              </label>
              <span className="text-caption text-foreground-muted">
                {String(nameLengthNow)} of {String(MAX_TEAM_NAME_LENGTH)}
              </span>
            </div>
            <input
              id="team-name"
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
              No one is free to add. Your partner needs to open the app and tap Join this outing
              first, and cannot already be on a team.
            </p>
          ) : (
            <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
              {candidates.map(({ user }) => {
                const picked = user.id === partnerId;
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => {
                        setPartnerId(user.id);
                      }}
                      className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-border px-4 py-2 text-left last:border-b-0"
                    >
                      <span className="min-w-0 text-body font-medium break-words">
                        {displayName(user.name)}
                      </span>
                      <span className="shrink-0 text-body font-medium text-primary">
                        {picked ? "Selected" : "Select"}
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
            <p className="mb-2 text-center text-caption text-foreground-muted">{OFFLINE_NOTE}</p>
          )}
          <button
            type="button"
            disabled={busy || !canChange || needsPartner}
            onClick={() => void submit()}
            className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Saving…" : label}
          </button>
        </div>
      </div>
    </div>
  );
}
