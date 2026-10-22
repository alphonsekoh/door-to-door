import type { Visit } from "@/generated/types.gen";
import { teamName, visitByline } from "@/lib/teams/team-label";

/*
 * Who recorded a visit, and the team it was stamped with, in words. Spans
 * only, so it can sit inside a button or a link. Nothing is truncated: a long
 * name or a big team wraps rather than hiding who was there.
 */

export function TeamChip({ name }: { name: string }) {
  return (
    <span className="inline-block max-w-full rounded-md border border-border bg-surface-muted px-2 py-0.5 text-caption font-medium break-words">
      Team: {name}
    </span>
  );
}

export function VisitByline({
  visit,
  prefix = "",
  withTeam = true,
}: {
  visit: Pick<Visit, "member" | "team">;
  prefix?: string;
  withTeam?: boolean;
}) {
  const team = withTeam ? teamName(visit) : null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-foreground-muted">
      <span className="min-w-0 break-words">
        {prefix}
        {visitByline(visit)}
      </span>
      {team === null ? null : <TeamChip name={team} />}
    </span>
  );
}
