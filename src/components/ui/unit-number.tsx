import type { FollowUp } from "@/generated/types.gen";

/*
 * A unit number as it is written on the door, never broken at its hyphen:
 * at large text "#06-" on one line and "203" on the next reads as two
 * different doors.
 */
export function UnitNumber({ value }: { value: string }) {
  return <span className="whitespace-nowrap">{value}</span>;
}

/*
 * Words, each one holding a hyphen kept on one line as a unit number is: at
 * large text "Follow-" over "up" beside Undo read as two words. For text
 * built elsewhere, a server's reason among it, that may name a unit. Unlike
 * a unit number, one wider than the whole line still breaks (whole-word):
 * these words are longer, and a title's are larger.
 */
export function WholeWords({ text }: { text: string }) {
  /* Split on a capturing group, so the hyphenated words are the odd parts. */
  return text.split(/(\S+-\S+)/).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="whole-word">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/* The door a follow-up is for: "Blk 123 · #05-123". */
export function FollowUpDoor({ note }: { note: Pick<FollowUp, "blockName" | "unitNumber"> }) {
  /* One element, so a flex parent cannot make the text and the unit two
     items and drop the space between them. */
  return (
    <span>
      Blk {note.blockName} · <UnitNumber value={note.unitNumber} />
    </span>
  );
}
