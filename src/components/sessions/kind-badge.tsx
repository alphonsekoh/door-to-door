import type { SessionKind } from "@/generated/types.gen";

/*
 * Marks a follow-up session wherever sessions are listed or named. A
 * door-to-door session is the everyday kind and carries no badge, so the
 * badge is only ever news.
 */
export function KindBadge({ kind }: { kind: SessionKind }) {
  if (kind !== "follow_up") return null;
  return (
    <span className="inline-block shrink-0 rounded-md border border-primary/60 bg-primary/10 px-2 py-0.5 text-caption font-medium">
      Follow-up
    </span>
  );
}
