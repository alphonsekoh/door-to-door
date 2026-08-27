import Link from "next/link";
import type { SessionBlock } from "@/generated/types.gen";

/*
 * One block in the picker. Blocks are shared, never claimed: showing who is
 * already working here is informational, so two members can split floors
 * without the app getting in the way.
 */
export function BlockCard({ entry }: { entry: SessionBlock }) {
  const { block, visitCount, householdCount, activeMembers } = entry;
  const names = activeMembers.map((member) => member.name ?? "Someone");

  return (
    <li>
      <Link
        href={`/blocks/${block.id}`}
        className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
      >
        <span className="min-w-0">
          <span className="block text-title font-semibold">Blk {block.name}</span>
          <span className="block truncate text-caption text-foreground-muted">{block.street}</span>
          {names.length > 0 ? (
            <span className="mt-1 block truncate text-caption text-foreground-muted">
              {names.join(", ")} here now
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-title font-semibold tabular-nums">{householdCount}</span>
          <span className="block text-caption text-foreground-muted">
            {householdCount === 1 ? "unit" : "units"}
          </span>
          {visitCount > householdCount ? (
            <span className="block text-caption text-foreground-muted tabular-nums">
              {visitCount} visits
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
