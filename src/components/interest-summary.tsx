import type { InterestBreakdown } from "@/generated/types.gen";
import { interestSegments, totalRecorded } from "@/lib/history";

const BAR: Record<string, string> = {
  high: "bg-interest-high",
  medium: "bg-interest-medium",
  low: "bg-interest-low",
  no_response: "bg-interest-none",
};

/*
 * How a session went, as a proportional bar plus the numbers.
 *
 * The bar is decoration; the counts underneath are the content. Nothing here
 * depends on telling the four colours apart.
 */
export function InterestSummary({ interest }: { interest: InterestBreakdown }) {
  const segments = interestSegments(interest);
  const total = totalRecorded(interest);

  if (total === 0) {
    return null;
  }

  return (
    <div>
      <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-surface-muted">
        {segments.map((segment) => (
          <span
            key={segment.level}
            className={BAR[segment.level]}
            style={{ width: `${String((segment.count / total) * 100)}%` }}
          />
        ))}
      </div>

      <p className="mt-1.5 text-caption text-foreground-muted">
        {segments.map((segment) => `${segment.label} ${String(segment.count)}`).join(" · ")}
      </p>
    </div>
  );
}
