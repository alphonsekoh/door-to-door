import Link from "next/link";
import { InterestSummary } from "@/components/interest-summary";
import type { SessionHistorySummary } from "@/generated/types.gen";
import { isSameDay } from "@/lib/history";
import { formatDay } from "@/lib/dates";

/* An outing spanning midnight, or reopened days later, needs both ends. */
function dateRange(from: string, to: string): string {
  const start = formatDay(from);
  if (isSameDay(from, to)) {
    return start;
  }
  return `${start} – ${formatDay(to)}`;
}

/*
 * One outing, as the member who worked it experienced it. Every number here is
 * theirs alone - a second member on the same block sees different ones.
 */
export function SessionHistoryCard({ summary }: { summary: SessionHistorySummary }) {
  const { session, blocks, visitCount, householdCount, interest } = summary;
  const names = blocks.map((block) => `Blk ${block.name}`).join(", ");

  return (
    <li>
      <Link
        href={`/history/${session.id}`}
        className="block press rounded-xl border border-border bg-surface p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-title font-semibold">{session.title}</span>
          <span className="shrink-0 text-caption text-foreground-muted">
            {dateRange(summary.firstRecordedAt, summary.lastRecordedAt)}
          </span>
        </div>

        <p className="mt-1 truncate text-body text-foreground-muted">
          {names === "" ? "No blocks recorded" : names}
        </p>

        <p className="mt-2 text-body">
          <span className="font-semibold tabular-nums">{householdCount}</span>{" "}
          {householdCount === 1 ? "unit" : "units"}
          {visitCount > householdCount ? (
            <span className="text-foreground-muted tabular-nums"> · {visitCount} visits</span>
          ) : null}
        </p>

        <div className="mt-3">
          <InterestSummary interest={interest} />
        </div>
      </Link>
    </li>
  );
}
