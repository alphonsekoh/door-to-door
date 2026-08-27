import type { InterestLevel } from "@/generated/types.gen";

/*
 * Interest level as a compact chip for list rows.
 *
 * The word carries the meaning and the colour reinforces it, never the other
 * way round: stairwell lighting is bad, phones get held in bright sun, and
 * roughly one man in twelve cannot separate the red from the green.
 */

const CHIPS: Record<InterestLevel, { label: string; className: string }> = {
  high: { label: "High", className: "border-interest-high bg-interest-high/20" },
  medium: { label: "Medium", className: "border-interest-medium bg-interest-medium/20" },
  low: { label: "Low", className: "border-interest-low bg-interest-low/20" },
  no_response: { label: "No answer", className: "border-interest-none bg-interest-none/15" },
};

export function InterestChip({ level }: { level: InterestLevel }) {
  const chip = CHIPS[level];
  return (
    <span
      className={`shrink-0 rounded-md border px-2 py-0.5 text-caption font-medium ${chip.className}`}
    >
      {chip.label}
    </span>
  );
}
