import type { RevisitState } from "@/lib/follow-ups/revisits";

const PILL: Record<"visited" | "done", { label: string; className: string }> = {
  visited: { label: "Visited", className: "border-primary/60 bg-primary/10" },
  done: { label: "Done", className: "border-interest-high bg-interest-high/20" },
};

/* Where a household on a follow-up session's list stands, online and on the
   offline shell alike; nothing while it is still to visit. */
export function RevisitPill({ state }: { state: RevisitState }) {
  if (state === "to_visit") return null;
  return (
    <span
      className={`shrink-0 rounded-md border px-2 py-0.5 text-caption font-medium ${PILL[state].className}`}
    >
      {PILL[state].label}
    </span>
  );
}
