"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminTeamSheet, type AdminTeamSubmit } from "@/components/admin/admin-team-sheet";
import type { SessionStatus, Team, TeamList, User, UserSummary } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import {
  ADMIN_OFFLINE_NOTE,
  ADMIN_UNSYNCED_NOTE,
  adminCandidates,
  describeAdminTeamFailure,
  describeTeamFailure,
  displayName,
  isNetworkFailure,
  type AdminTeamAction,
} from "@/lib/teams/team-ui";
import { useOnline } from "@/lib/hooks/use-online";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { useRole } from "@/lib/hooks/use-role";
import { loadAllUsers } from "@/lib/session/users";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";

type Loaded = { teams: Team[]; users: User[] };

type Sheet = { mode: "create" } | { mode: "rename" | "add"; team: Team } | null;

type Confirm = { kind: "remove"; team: Team; member: UserSummary } | { kind: "delete"; team: Team };

const BUTTON =
  "min-h-11 rounded-lg border border-border px-3 text-body font-medium disabled:opacity-60";

/*
 * Every team in one session, for an admin to arrange (D-74-14, D-74-15).
 *
 * Follows the server's rules rather than its own: an admin may fix teams on a
 * draft, a running or an ended session, but no new team can be formed once it
 * has ended. Online-only like the member card (D-74-19); nothing is queued.
 *
 * `tick` is bumped by the detail screen's own poll, so the panel re-reads
 * with it rather than running a second timer.
 */
export function AdminTeams({
  sessionId,
  status,
  tick,
}: {
  sessionId: string;
  status: SessionStatus;
  tick: number;
}) {
  const online = useOnline();
  const { userId } = useRole();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionFailure, setActionFailure] = useState<string | null>(null);

  /* Two reads can cross on a bad connection; only the newest may land. */
  const generation = useRef(0);
  /* Set synchronously: state is not updated between two taps in one frame. */
  const inFlight = useRef(false);
  /* Remove and Delete team, noted on the card, never on their confirm: a
     refusal ends on them, where D-90-9 returns focus too. A sheet's refusal
     keeps the sheet open, and the sheet gives focus back itself. */
  const { notePress, refused } = useRefusalFocus();

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const [teams, users] = await Promise.all([
        apiFetch<TeamList>(`/sessions/${sessionId}/teams`),
        loadAllUsers(),
      ]);
      if (mine !== generation.current) return;
      setData({ teams: teams.data, users });
      setLoadFailure(null);
      setUnreachable(false);
      setAuthFailed(false);
    } catch (error) {
      if (mine !== generation.current) return;
      const failure = describeTeamFailure(error, "read");
      setUnreachable(failure.network);
      setAuthFailed(failure.auth);
      setLoadFailure(
        failure.auth || failure.network ? failure.message : "Could not load the teams.",
      );
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load, tick]);

  /* Runs a change, then re-reads so every list agrees with the server. */
  async function change(action: AdminTeamAction, run: () => Promise<unknown>): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionFailure(null);
    setBusy(true);
    try {
      await run();
      setUnreachable(false);
      await load();
    } catch (error) {
      const failure = describeAdminTeamFailure(error, action);
      if (isNetworkFailure(error)) setUnreachable(true);
      if (failure.auth) setAuthFailed(true);
      /* Someone offered in a picker may no longer be free. */
      if (error instanceof ApiRequestError && error.status === 409) void load();
      setActionFailure(failure.message);
      throw error;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submit(open: NonNullable<Sheet>, { name, memberIds }: AdminTeamSubmit) {
    await change(open.mode, async () => {
      if (open.mode === "create") {
        await apiFetch<Team>(`/sessions/${sessionId}/teams`, {
          method: "POST",
          body: JSON.stringify({ name, memberIds }),
        });
      } else if (open.mode === "rename") {
        await apiFetch<Team>(`/teams/${open.team.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
      } else {
        await apiFetch<Team>(`/teams/${open.team.id}/members`, {
          method: "POST",
          body: JSON.stringify({ userId: memberIds[0] }),
        });
      }
    });
    setSheet(null);
  }

  async function confirmed(open: Confirm): Promise<void> {
    try {
      await change(open.kind, () =>
        open.kind === "delete"
          ? apiFetch(`/teams/${open.team.id}`, { method: "DELETE" })
          : apiFetch<Team>(`/teams/${open.team.id}/members/${open.member.id}`, {
              method: "DELETE",
            }),
      );
    } catch {
      /* change() has already put the reason on screen. */
      refused();
    }
    setConfirm(null);
  }

  if (data === null) {
    return loadFailure === null ? null : (
      <section
        aria-label="Teams"
        role="alert"
        className="rounded-xl border border-border bg-surface-muted p-4"
      >
        <p className="text-body">{loadFailure}</p>
        <button type="button" onClick={() => void load()} className={`mt-3 ${BUTTON}`}>
          Try again
        </button>
      </section>
    );
  }

  const { teams, users } = data;
  const canChange = online && !unreachable && !authFailed;
  const disabled = busy || !canChange;
  const candidates = adminCandidates(users, teams);

  return (
    <section aria-label="Teams" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <h2 className="text-title font-semibold">Teams</h2>
        {status === "ended" ? null : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setActionFailure(null);
              setSheet({ mode: "create" });
            }}
            className={`shrink-0 ${BUTTON}`}
          >
            New team
          </button>
        )}
      </div>

      {status === "ended" ? (
        <p className="text-body text-foreground-muted">
          This session has ended, so no new team can be formed. Existing teams can still be fixed.
        </p>
      ) : null}

      {teams.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          No teams in this session.
        </p>
      ) : (
        <ul className="space-y-2">
          {teams.map((team) => (
            <li
              key={team.id}
              aria-label={team.name}
              className="space-y-2 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <p className="text-body font-semibold break-words">{team.name}</p>
              {team.members.length === 0 ? (
                <p className="text-caption text-foreground-muted">Nobody is on this team now.</p>
              ) : (
                <ul className="space-y-1">
                  {team.members.map((member) => (
                    // At large text Remove drops under the name rather than
                    // set it a word a line.
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                    >
                      <span className="min-w-0 flex-[1_1_12ch] text-body break-words">
                        {displayName(member.name)}
                        {member.id === userId ? " (you)" : ""}
                      </span>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Remove ${displayName(member.name)} from ${team.name}`}
                        onClick={() => {
                          notePress();
                          setActionFailure(null);
                          setConfirm({ kind: "remove", team, member });
                        }}
                        className={`ml-auto shrink-0 ${BUTTON}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setActionFailure(null);
                    setSheet({ mode: "rename", team });
                  }}
                  className={BUTTON}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setActionFailure(null);
                    setSheet({ mode: "add", team });
                  }}
                  className={BUTTON}
                >
                  Add member
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    notePress();
                    setActionFailure(null);
                    setConfirm({ kind: "delete", team });
                  }}
                  className={BUTTON}
                >
                  Delete team
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canChange ? null : (
        <p className="text-caption font-medium text-foreground-muted">{ADMIN_OFFLINE_NOTE}</p>
      )}

      {authFailed && loadFailure !== null && actionFailure === null ? (
        <p role="alert" className="notice-danger">
          {loadFailure}
        </p>
      ) : null}

      {actionFailure !== null && sheet === null ? (
        <p role="alert" className="notice-danger">
          {actionFailure}
        </p>
      ) : null}

      <p className="text-caption text-foreground-muted">{ADMIN_UNSYNCED_NOTE}</p>

      <SheetPresence>
        {sheet === null ? null : (
          <AdminTeamSheet
            key={sheet.mode}
            mode={sheet.mode}
            initialName={sheet.mode === "create" ? "" : sheet.team.name}
            candidates={candidates}
            meId={userId}
            canChange={canChange}
            onSubmit={(value) => submit(sheet, value)}
            onClose={() => {
              setSheet(null);
              setActionFailure(null);
            }}
          />
        )}
      </SheetPresence>

      <SheetPresence>
        {confirm === null ? null : confirm.kind === "delete" ? (
          <ConfirmDialog
            title={`Delete ${confirm.team.name}?`}
            detail="Only a team with no records can be deleted. If this team recorded anything, remove its members instead."
            confirmLabel="Delete team"
            busy={busy}
            onConfirm={() => void confirmed(confirm)}
            onCancel={() => {
              setConfirm(null);
            }}
          />
        ) : (
          <ConfirmDialog
            title={`Remove ${displayName(confirm.member.name)} from ${confirm.team.name}?`}
            detail="Their records keep this team, and the team keeps access to them. They lose access to their teammates' records."
            confirmLabel="Remove from team"
            busy={busy}
            onConfirm={() => void confirmed(confirm)}
            onCancel={() => {
              setConfirm(null);
            }}
          />
        )}
      </SheetPresence>
    </section>
  );
}
