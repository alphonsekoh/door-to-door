import type { HistoryEntry } from "@/generated/types.gen";
import { teamName, teammateNames } from "@/lib/teams/team-label";
import { displayName } from "@/lib/teams/team-ui";

/*
 * CSV for the export of a filtered history view.
 *
 * Hand-rolled rather than pulled in: the whole job is quoting, and a
 * dependency for that would be more surface than the twelve lines below.
 */

/*
 * Quoted whenever the value could otherwise break the row, and always when it
 * starts with a character a spreadsheet would treat as a formula. That last
 * part matters because a description is free text typed at a door, and names,
 * contacts and notes are stored as typed, untrimmed. A leading tab or CR is
 * itself a formula start to some; others trim leading whitespace, control and
 * format characters (a zero-width space, say) before deciding.
 */
const FORMULA_START = [/^[\t\r]/, /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u];

/*
 * A spreadsheet whose separator is `;` honours a `"` only where it opens one
 * of its own fields, which none of ours past the first in a row does. So it
 * starts a new field after every `;` and line break inside a value, and each
 * one that leads to a sign gets a `'` of its own. A `"` is skipped like
 * whitespace there, since that reader can unwrap it; a line break is not, as
 * it starts a field of its own. A `,` needs nothing: a value holding one is
 * quoted, and to that reader it is not a separator.
 */
const FIELD_INSIDE = /([;\r\n])(?=\t|(?:(?![\r\n])[\s\p{Cc}\p{Cf}"])*[=+\-@])/gu;

export function escapeCell(value: string): string {
  const risky = /[",\n\r]/.test(value);
  const formula = FORMULA_START.some((start) => start.test(value));
  const guarded = value.replace(FIELD_INSIDE, "$1'");
  const cell = formula ? `'${guarded}` : guarded;
  return risky || formula ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

const HEADERS = [
  "Block",
  "Street",
  "Unit",
  "Name",
  "Contact",
  "Religion",
  "Interest",
  "Notes",
  "Recorded by",
  "Team",
  "Teammates",
  "Session",
  "Recorded at",
];

export function historyToCsv(entries: HistoryEntry[]): string {
  const rows = entries.map((entry) => [
    entry.block.name,
    entry.block.street,
    entry.household.unitNumber,
    entry.household.name ?? "",
    entry.household.contact ?? "",
    entry.household.religion ?? "",
    entry.visit.interestLevel,
    entry.visit.description,
    /* The person is known, only their name is not - the same word as a
       nameless teammate gets, so the two columns agree. */
    displayName(entry.visit.member.name),
    /* Team and member names are typed by people, so they go through the same
       formula guard as everything else (D-30-4). */
    teamName(entry.visit) ?? "",
    teammateNames(entry.visit).join("; "),
    entry.session.title,
    entry.visit.createdAt,
  ]);
  return toCsv([HEADERS, ...rows]);
}
