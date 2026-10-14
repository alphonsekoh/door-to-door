import type { HistoryEntry } from "@/generated/types.gen";
import { teamName, teammateNames } from "@/lib/team-label";
import { displayName } from "@/lib/team-ui";

/*
 * CSV for the export of a filtered history view.
 *
 * Hand-rolled rather than pulled in: the whole job is quoting, and a
 * dependency for that would be more surface than the twelve lines below.
 */

/*
 * Quoted whenever the value could otherwise break the row, and always when it
 * starts with a character a spreadsheet would treat as a formula. That last
 * part matters because a description is free text typed at a door.
 */
export function escapeCell(value: string): string {
  const risky = /[",\n\r]/.test(value);
  const formula = /^[=+\-@\t]/.test(value);
  const cell = formula ? `'${value}` : value;
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
  "Outing",
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
