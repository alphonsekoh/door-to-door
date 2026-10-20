import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
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
      {/* At large text the count drops under the block rather than squeeze
          its street and who is here to a few letters. */}
      <Link
        href={`/blocks/${block.id}`}
        className="relative flex min-h-16 press flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3"
      >
        <span className="min-w-0 flex-[1_1_12ch]">
          <span className="block text-title font-semibold whitespace-nowrap">Blk {block.name}</span>
          <span className="block truncate text-caption text-foreground-muted">{block.street}</span>
          {names.length > 0 ? (
            <span className="mt-1 block truncate text-caption text-foreground-muted">
              {names.join(", ")} here now
            </span>
          ) : null}
        </span>

        <span className="ml-auto shrink-0 text-right">
          <span className="block text-title font-semibold tabular-nums">{householdCount}</span>
          {/* This session's units, not the block's: "units" alone read as
              the size of the block. */}
          <span className="block text-caption text-foreground-muted">visited tonight</span>
          {visitCount > householdCount ? (
            <span className="block text-caption text-foreground-muted tabular-nums">
              {visitCount} visits
            </span>
          ) : null}
        </span>
        <LinkPending />
      </Link>
    </li>
  );
}
