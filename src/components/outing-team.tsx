"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TeamSheet, type TeamSheetSubmit } from "@/components/team-sheet";
import type { Participant, ParticipantList, Team, TeamList, User } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import {
  OFFLINE_NOTE,
  UNSYNCED_LIMIT_NOTE,
  canChangeTeam,
  describeTeamFailure,
  displayName,
  findMyTeam,
  hasJoined,
  isNetworkFailure,
  pickerCandidates,
} from "@/lib/team-ui";
import { useOnline } from "@/lib/use-online";
import { loadCurrentUser } from "@/lib/users";
import { ConfirmDialog, SheetPresence } from "@/components/sheet";

type Loaded = { me: User; participants: Participant[]; teams: Team[] };

type Sheet = { mode: "create" } | { mode: "rename" | "add"; teamId: string } | null;

const BUTTON =
  "min-h-11 rounded-lg border border-border px-3 text-body font-medium disabled:opacity-60";

/*
 * Joining the outing and pairing up, for the running outing only.
 *
 * Team changes are server truth and never queued (D-74-19): offline, every
 * control is disabled rather than accepted and replayed later.
 *
 * `tick` is bumped by the screen's own poll and Refresh, so this re-reads
 * with it and a teammate who added you appears without a second timer.
 */
export function OutingTeam({ sessionId, tick }: { sessionId: string; tick: number }) {
  const online = useOnline();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  /* A failed request is offline whatever navigator.onLine claims. */
  const [unreachable, setUnreachable] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [actionFailure, setActionFailure] = useState<string | null>(null);

  /* Two reads can cross on a bad connection; only the newest may land. */
  const generation = useRef(0);
  /* Set synchronously: state is not updated between two taps in one frame. */
  const inFlight = useRef(false);
  const wasOnline = useRef(online);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const [me, participants, teams] = await Promise.all([
        loadCurrentUser(),
        apiFetch<ParticipantList>(`/sessions/${sessionId}/participants`),
        apiFetch<TeamList>(`/sessions/${sessionId}/teams`),
      ]);
      if (mine !== generation.current) return;
      setData({ me, participants: participants.data, teams: teams.data });
      setLoadFailure(null);
      setUnreachable(false);
      setAuthFailed(false);
    } catch (error) {
      if (mine !== generation.current) return;
      const failure = describeTeamFailure(error, "read");
      setUnreachable(failure.network);
      setAuthFailed(failure.auth);
      setLoadFailure(failure.message);
    }
  }, [sessionId]);

  useEffect(() => {
    /* Deferred like the screen's own load: it sets state. */
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load, tick]);

  /* Coming back online re-reads at once rather than at the next poll. */
  useEffect(() => {
    const returned = online && !wasOnline.current;
    wasOnline.current = online;
    if (!returned) return;
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [online, load]);

  /* Runs a change, then re-reads so every list agrees with the server. */
  async function change(action: () => Promise<unknown>): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionFailure(null);
    setBusy(true);
    try {
      await action();
      setUnreachable(false);
      await load();
    } catch (error) {
      const failure = describeTeamFailure(error, "change");
      if (isNetworkFailure(error)) setUnreachable(true);
      if (failure.auth) setAuthFailed(true);
      /* The picker may be offering someone who is no longer free. */
      if (error instanceof ApiRequestError && error.status === 409) void load();
      setActionFailure(failure.message);
      throw error;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (data === null) {
    return loadFailure === null ? null : (
      <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
        <p className="text-body">{loadFailure}</p>
        <button type="button" onClick={() => void load()} className={`mt-3 ${BUTTON}`}>
          Try again
        </button>
      </div>
    );
  }

  const { me, participants, teams } = data;
  const joined = hasJoined(participants, me.id);
  const team = findMyTeam(teams, me.id);
  const canChange = canChangeTeam(online && !unreachable && !authFailed, true);
  const candidates = pickerCandidates(participants, me.id);
  /* The server only places a member on their own team; an admin is added
     explicitly so the team they form is theirs. */
  const alsoMe = me.role === "admin" ? [me.id] : [];

  async function submit(
    open: NonNullable<Sheet>,
    { name, partnerId }: TeamSheetSubmit,
  ): Promise<void> {
    await change(async () => {
      if (open.mode === "create") {
        await apiFetch<Team>(`/sessions/${sessionId}/teams`, {
          method: "POST",
          body: JSON.stringify({ name, memberIds: [...alsoMe, partnerId] }),
        });
      } else if (open.mode === "rename") {
        await apiFetch<Team>(`/teams/${open.teamId}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
      } else {
        await apiFetch<Team>(`/teams/${open.teamId}/members`, {
          method: "POST",
          body: JSON.stringify({ userId: partnerId }),
        });
      }
    });
    setSheet(null);
  }

  async function leave(teamId: string): Promise<void> {
    try {
      await change(() => apiFetch<Team>(`/teams/${teamId}/members/${me.id}`, { method: "DELETE" }));
    } catch {
      /* change() has already put the reason on screen. */
    }
    setLeaving(false);
  }

  async function join(): Promise<void> {
    try {
      await change(() => apiFetch<Participant>(`/sessions/${sessionId}/join`, { method: "POST" }));
    } catch {
      /* change() has already put the reason on screen. */
    }
  }

  return (
    <section
      aria-label="Your team"
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      {joined ? (
        <p className="text-body font-medium">You&apos;ve joined this session</p>
      ) : (
        <div>
          <button
            type="button"
            disabled={busy || !canChange}
            onClick={() => void join()}
            className="min-h-12 w-full btn-primary rounded-xl text-body font-semibold"
          >
            Join this session
          </button>
        </div>
      )}

      {team ? (
        <div className="space-y-2">
          <p className="text-caption font-medium text-foreground-muted uppercase">Your team</p>
          <p className="text-title font-semibold break-words">{team.name}</p>
          <ul className="flex flex-wrap gap-2">
            {team.members.map((member) => (
              <li
                key={member.id}
                className="max-w-full rounded-lg bg-surface-muted px-3 py-1 text-body break-words"
              >
                {displayName(member.name)}
                {member.id === me.id ? " (you)" : ""}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !canChange}
              onClick={() => {
                setSheet({ mode: "rename", teamId: team.id });
              }}
              className={BUTTON}
            >
              Rename
            </button>
            <button
              type="button"
              disabled={busy || !canChange}
              onClick={() => {
                setSheet({ mode: "add", teamId: team.id });
              }}
              className={BUTTON}
            >
              Add member
            </button>
            <button
              type="button"
              disabled={busy || !canChange}
              onClick={() => {
                setLeaving(true);
              }}
              className={BUTTON}
            >
              Leave
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-body text-foreground-muted">You are not on a team yet.</p>
          <button
            type="button"
            disabled={busy || !canChange}
            onClick={() => {
              setSheet({ mode: "create" });
            }}
            className={BUTTON}
          >
            Pair up
          </button>
        </div>
      )}

      {canChange ? null : (
        <p className="text-caption font-medium text-foreground-muted">{OFFLINE_NOTE}</p>
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

      <p className="text-caption text-foreground-muted">{UNSYNCED_LIMIT_NOTE}</p>

      <SheetPresence>
        {sheet === null ? null : (
          <TeamSheet
            key={sheet.mode}
            mode={sheet.mode}
            myName={me.name}
            initialName={team?.name ?? ""}
            candidates={candidates}
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
        {leaving && team ? (
          <ConfirmDialog
            title="Leave this team?"
            detail="Your teammates keep access to what you recorded. You lose access to theirs."
            confirmLabel="Leave team"
            busy={busy}
            onConfirm={() => void leave(team.id)}
            onCancel={() => {
              setLeaving(false);
            }}
          />
        ) : null}
      </SheetPresence>
    </section>
  );
}
