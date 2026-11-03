import { type AnyColumn, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { FollowUpStatus } from "@/db/schema";
import { blocks, followUps, households, users, visits } from "@/db/schema";

/*
 * The body of `npm run db:check-blank` (#119), kept out of scripts/ so it is
 * tested. Before #119 a unit number, note, block name or street of nothing
 * but spaces was trimmed to '' and stored, and the migration that forbids
 * them fails on a database that holds one. This lists every such row so an
 * operator can find it. It never changes anything: how each is repaired is
 * the owner's call.
 *
 * Each query uses the CHECK's own test, inverted, so a clean report means
 * the migration will apply (D-119-10).
 */

export type BlankHousehold = {
  id: string;
  blockId: string;
  blockName: string;
  street: string;
  unitNumber: string;
  createdAt: Date;
  visitCount: number;
  /* The earliest knock recorded there, by when it happened at the door. */
  firstVisit: { id: string; memberEmail: string; at: Date } | null;
};

export type BlankFollowUp = {
  id: string;
  householdId: string;
  blockName: string;
  street: string;
  unitNumber: string;
  note: string;
  status: FollowUpStatus;
  authorEmail: string;
  createdAt: Date;
  removed: boolean;
};

export type BlankBlock = { id: string; name: string; street: string; createdAt: Date };

export type BlankText = {
  households: BlankHousehold[];
  followUps: BlankFollowUp[];
  blocks: BlankBlock[];
};

/* The inverse of each `<table>_<col>_not_blank` constraint. */
const blank = (column: AnyColumn) => sql`btrim(${column}) = ''`;

async function blankHouseholds(db: Database): Promise<BlankHousehold[]> {
  const rows = await db
    .select({
      id: households.id,
      blockId: households.blockId,
      blockName: blocks.name,
      street: blocks.street,
      unitNumber: households.unitNumber,
      createdAt: households.createdAt,
    })
    .from(households)
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .where(blank(households.unitNumber))
    .orderBy(asc(households.createdAt), asc(households.id));
  if (rows.length === 0) return [];

  /* One read for all of them, earliest first, rather than a subquery per row. */
  const knocks = await db
    .select({
      householdId: visits.householdId,
      id: visits.id,
      memberEmail: users.email,
      at: visits.clientCreatedAt,
    })
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(
      inArray(
        visits.householdId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(visits.clientCreatedAt), asc(visits.id));

  return rows.map((row) => {
    const mine = knocks.filter((knock) => knock.householdId === row.id);
    const first = mine[0];
    return {
      ...row,
      visitCount: mine.length,
      firstVisit:
        first === undefined ? null : { id: first.id, memberEmail: first.memberEmail, at: first.at },
    };
  });
}

/* Removed notes too: the constraint holds every row, whatever a screen shows. */
async function blankFollowUps(db: Database): Promise<BlankFollowUp[]> {
  const rows = await db
    .select({
      id: followUps.id,
      householdId: followUps.householdId,
      blockName: blocks.name,
      street: blocks.street,
      unitNumber: households.unitNumber,
      note: followUps.note,
      status: followUps.status,
      authorEmail: users.email,
      createdAt: followUps.createdAt,
      deletedAt: followUps.deletedAt,
    })
    .from(followUps)
    .innerJoin(households, eq(households.id, followUps.householdId))
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .innerJoin(users, eq(users.id, followUps.authorId))
    .where(blank(followUps.note))
    .orderBy(asc(followUps.createdAt), asc(followUps.id));
  return rows.map(({ deletedAt, ...row }) => ({ ...row, removed: deletedAt !== null }));
}

function blankBlocks(db: Database): Promise<BlankBlock[]> {
  return db
    .select({
      id: blocks.id,
      name: blocks.name,
      street: blocks.street,
      createdAt: blocks.createdAt,
    })
    .from(blocks)
    .where(or(blank(blocks.name), blank(blocks.street)))
    .orderBy(asc(blocks.createdAt), asc(blocks.id));
}

export async function findBlankText(db: Database): Promise<BlankText> {
  return {
    households: await blankHouseholds(db),
    followUps: await blankFollowUps(db),
    blocks: await blankBlocks(db),
  };
}

export const CLEAN_MESSAGE = "No blank unit numbers, follow-up notes, block names or streets.";

export const HOUSEHOLD_CAUTION =
  "Deleting a household also deletes its visits and follow-up notes, so give it its real unit " +
  "number instead. If that unit already exists in the block, move the visits and notes there " +
  "first. See Deployment in the README.";

/* Quoted, so "" and "   " can be told apart from each other and from a name. */
const quote = (value: string): string => JSON.stringify(value);
const time = (value: Date): string => value.toISOString();
const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

function householdLine(row: BlankHousehold): string {
  const first =
    row.firstVisit === null
      ? "no visits"
      : `${plural(row.visitCount, "visit", "visits")}, the first ${row.firstVisit.id} by ${row.firstVisit.memberEmail} at ${time(row.firstVisit.at)}`;
  return (
    `  household ${row.id}: unit ${quote(row.unitNumber)} in Blk ${quote(row.blockName)}, ` +
    `${quote(row.street)} (block ${row.blockId}), created ${time(row.createdAt)}; ${first}`
  );
}

function followUpLine(row: BlankFollowUp): string {
  return (
    `  follow-up ${row.id}: note ${quote(row.note)}, ${row.status}${row.removed ? ", removed" : ""}, ` +
    `by ${row.authorEmail}, created ${time(row.createdAt)}; at unit ${quote(row.unitNumber)} ` +
    `in Blk ${quote(row.blockName)}, ${quote(row.street)} (household ${row.householdId})`
  );
}

function blockLine(row: BlankBlock): string {
  return `  block ${row.id}: name ${quote(row.name)}, street ${quote(row.street)}, created ${time(row.createdAt)}`;
}

/*
 * What the script prints, and how it exits: 0 when there is nothing to fix,
 * 1 when there is (D-119-11), so a deploy can stop before the migration.
 */
export function formatBlankReport(found: BlankText): { lines: string[]; exitCode: 0 | 1 } {
  const sections = [
    { heading: "Households with a blank unit number", lines: found.households.map(householdLine) },
    { heading: "Follow-up notes that are blank", lines: found.followUps.map(followUpLine) },
    { heading: "Blocks with a blank name or street", lines: found.blocks.map(blockLine) },
  ].filter((section) => section.lines.length > 0);

  const total = sections.reduce((sum, section) => sum + section.lines.length, 0);
  if (total === 0) return { lines: [CLEAN_MESSAGE], exitCode: 0 };

  return {
    lines: [
      ...sections.flatMap((section) => [
        `${section.heading} (${String(section.lines.length)}):`,
        ...section.lines,
      ]),
      `${plural(total, "row holds", "rows hold")} blank text. Nothing was changed. ` +
        "The not-blank migration (0005_not_blank_text) fails until each is corrected or removed by hand.",
      // Visits and notes cascade from a household: deleting one to get the
      // migration through would lose the record the app exists to keep.
      ...(found.households.length > 0 ? [HOUSEHOLD_CAUTION] : []),
    ],
    exitCode: 1,
  };
}

/* Read only, so the check cannot change anything even by mistake. */
export async function runBlankTextCheck(
  db: Database,
): Promise<{ lines: string[]; exitCode: 0 | 1 }> {
  const found = await db.transaction((tx) => findBlankText(tx), { accessMode: "read only" });
  return formatBlankReport(found);
}
