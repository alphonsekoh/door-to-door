"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { CreateSessionForm } from "@/components/sessions/create-session-form";
import { KindBadge } from "@/components/sessions/kind-badge";
import { SessionActionButton } from "@/components/sessions/session-action-button";
import type { OutingSession, SessionList, SessionStatus } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { availableActions, statusLabel } from "@/lib/session/sessions";

const PAGE_SIZE = 25;

const ADMIN_SCREENS = [
  { href: "/admin/follow-ups", label: "Follow-up list" },
  { href: "/admin/attention", label: "Needs a return visit" },
  { href: "/admin/history", label: "All records" },
  { href: "/admin/team", label: "Team" },
] as const;

type State =
  | { status: "loading" }
  | { status: "ready"; sessions: OutingSession[] }
  | { status: "error"; message: string };

/* Keyed by SessionStatus rather than string, so every status is covered and
   the lookup needs no fallback. */
const STATUS_STYLE: Record<SessionStatus, string> = {
  active: "border-interest-high bg-interest-high/20",
  draft: "border-interest-medium bg-interest-medium/20",
  ended: "border-interest-none bg-interest-none/15",
};

/*
 * The admin landing page's body. New session comes first and stays put: below
 * the notices and four links, it sat behind the bottom nav on a 664px iPhone.
 * `notices` (what waits for a decision, what is overdue) follow it, and only
 * the list waits for the sessions to load.
 */
export function AdminSessions({ notices }: { notices?: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const page = await apiFetch<SessionList>(`/sessions?limit=${String(PAGE_SIZE)}`);
      setState({ status: "ready", sessions: page.data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load the sessions.",
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  return (
    <div className="space-y-4">
      <CreateSessionForm onCreated={() => void load()} />
      {notices}

      {/* Two a row while each has 12ch, one a row past that: squeezed, "All
          records" was set a word a line at the largest text. */}
      <nav aria-label="Admin screens" className="flex flex-wrap gap-2">
        {ADMIN_SCREENS.map((screen) => (
          <Link
            key={screen.href}
            href={screen.href}
            className="flex min-h-12 flex-[1_1_max(40%,12ch)] btn-secondary items-center justify-center rounded-xl px-3 text-center text-body font-medium"
          >
            {screen.label}
          </Link>
        ))}
      </nav>

      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading…</p>
      ) : state.status === "error" ? (
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
      ) : (
        <SessionRows sessions={state.sessions} onChanged={() => void load()} />
      )}
    </div>
  );
}

function SessionRows({
  sessions,
  onChanged,
}: {
  sessions: OutingSession[];
  onChanged: () => void;
}) {
  return sessions.length === 0 ? (
    <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
      <p className="text-body font-medium">No sessions yet.</p>
      <p className="mt-1 text-body text-foreground-muted">
        Create one, attach the blocks, then start it when everyone is ready.
      </p>
    </div>
  ) : (
    <ul className="space-y-2">
      {sessions.map((session) => (
        <li key={session.id} className="rounded-xl border border-border bg-surface p-4">
          {/* At large text the action drops under the title rather than
              squeeze it to a sliver that paints over the button. */}
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <Link href={`/admin/sessions/${session.id}`} className="min-w-0 flex-[1_1_12ch]">
              <span className="block text-title font-semibold break-words">{session.title}</span>
              <span className="mt-1 flex flex-wrap gap-2">
                <span
                  className={`inline-block rounded-md border px-2 py-0.5 text-caption font-medium ${STATUS_STYLE[session.status]}`}
                >
                  {statusLabel(session.status)}
                </span>
                <KindBadge kind={session.kind} />
              </span>
            </Link>

            {/*
              The action sits on the row, not behind the detail screen.
              Reopening a session ended by mistake has to be two taps from
              here, because a member mid-amendment is locked out until it is.
            */}
            {availableActions(session.status).map((spec) => (
              <SessionActionButton
                key={spec.action}
                sessionId={session.id}
                spec={spec}
                primary={false}
                onDone={onChanged}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
