import type { HistoryEntry } from "@/generated/types.gen";

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
    entry.visit.member.name ?? "",
    entry.session.title,
    entry.visit.createdAt,
  ]);
  return toCsv([HEADERS, ...rows]);
}
