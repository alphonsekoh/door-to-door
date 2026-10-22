import Link from "next/link";
import { InterestSummary } from "@/components/ui/interest-summary";
import type { SessionHistorySummary } from "@/generated/types.gen";
import { isSameDay } from "@/lib/history";
import { formatDay } from "@/lib/dates";

/* A session spanning midnight, or reopened days later, needs both ends. */
function dateRange(from: string, to: string): string {
  const start = formatDay(from);
  if (isSameDay(from, to)) {
    return start;
  }
  return `${start} – ${formatDay(to)}`;
}

/*
 * One session, as the member who worked it experienced it. Every number here is
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
        {/* At large text the dates drop under the title. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="min-w-0 flex-[1_1_12ch] text-title font-semibold break-words">
            {session.title}
          </span>
          <span className="text-caption text-foreground-muted">
            {dateRange(summary.firstRecordedAt, summary.lastRecordedAt)}
          </span>
        </div>

        <p className="mt-1 truncate text-body text-foreground-muted">
          {names === "" ? "No blocks recorded" : names}
        </p>

        {/* Units this member visited, as the home card counts them: "units"
            alone read as the size of a block. */}
        <p className="mt-2 text-body">
          <span className="font-semibold tabular-nums">{householdCount}</span> visited
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
