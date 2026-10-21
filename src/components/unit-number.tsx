import type { FollowUp } from "@/generated/types.gen";

/*
 * A unit number as it is written on the door, never broken at its hyphen:
 * at large text "#06-" on one line and "203" on the next reads as two
 * different doors.
 */
export function UnitNumber({ value }: { value: string }) {
  return <span className="whitespace-nowrap">{value}</span>;
}

/* The door a follow-up is for: "Blk 123 · #05-123". */
export function FollowUpDoor({ note }: { note: Pick<FollowUp, "blockName" | "unitNumber"> }) {
  return (
    <>
      Blk {note.blockName} · <UnitNumber value={note.unitNumber} />
    </>
  );
}
