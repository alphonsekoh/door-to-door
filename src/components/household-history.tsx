import type { HouseholdHistory } from "@/generated/types.gen";

const INTEREST_LABEL: Record<string, string> = {
  no_response: "No response",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/*
 * What is already known about this unit, shown before the member knocks.
 *
 * This is the reason the household/visit split exists: arriving at a door
 * already knowing what was said last time, and what was promised.
 */
export function HouseholdHistoryPanel({ history }: { history: HouseholdHistory }) {
  const { household, visits, followUps } = history;
  const outstanding = followUps.filter((note) => note.doneAt === null);

  return (
    <section
      aria-label="What we know about this unit"
      className="rounded-xl border border-border bg-surface-muted p-4"
    >
      <p className="text-body font-semibold">{household.name ?? "Nobody has answered here yet"}</p>
      {household.contact === null ? null : (
        <p className="text-caption text-foreground-muted">{household.contact}</p>
      )}

      {outstanding.length > 0 ? (
        <div className="mt-3 rounded-lg border border-interest-medium/50 bg-interest-medium/10 p-3">
          <p className="text-caption font-semibold tracking-wide uppercase">
            {outstanding.length === 1 ? "Outstanding follow-up" : "Outstanding follow-ups"}
          </p>
          <ul className="mt-1 space-y-1">
            {outstanding.map((note) => (
              <li key={note.id} className="text-body">
                {note.note}
                <span className="text-foreground-muted"> — {note.author.name ?? "someone"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {visits.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {visits.map((visit) => (
            <li key={visit.id} className="text-caption">
              <span className="font-medium">
                {INTEREST_LABEL[visit.interestLevel] ?? visit.interestLevel}
              </span>
              <span className="text-foreground-muted">
                {" · "}
                {new Date(visit.createdAt).toLocaleDateString()}
                {" · "}
                {visit.member.name ?? "a member"}
              </span>
              {visit.description === "" ? null : (
                <p className="text-body text-foreground-muted">{visit.description}</p>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
