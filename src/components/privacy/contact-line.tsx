import type { Household } from "@/generated/types.gen";

/*
 * A household's contact, and, once someone marked it, that the person
 * withdrew their agreement to calls or messages (#279). Worded, not just
 * styled: it is what stops a member ringing the number.
 */
export function ContactLine({
  household,
}: {
  household: Pick<Household, "contact" | "contactWithdrawnAt">;
}) {
  if (household.contact === null) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-caption text-foreground-muted">
      <span className="min-w-0 break-words">{household.contact}</span>
      {household.contactWithdrawnAt == null ? null : (
        <span className="rounded-md border border-danger px-2 py-0.5 text-caption font-medium text-danger">
          No calls or messages
        </span>
      )}
    </p>
  );
}
