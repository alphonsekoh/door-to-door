import { asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { blocks } from "@/db/schema";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { ConflictError, NotFoundError } from "@/server/http/errors";

/*
 * The block registry. `(name, street)` is the natural key, so a duplicate is a
 * conflict rather than a second row - two "123 Ang Mo Kio Ave 3" entries would
 * split one block's history in half.
 */

export const BLOCK_NAME_STREET_CONSTRAINT = "blocks_name_street_unique";

export const isDuplicateBlock = (error: unknown): boolean =>
  isConstraintViolation(error, BLOCK_NAME_STREET_CONSTRAINT);

export type BlockRow = {
  id: string;
  name: string;
  street: string;
  postalCode: string | null;
  createdAt: Date;
};

const DUPLICATE_MESSAGE = "A block with that number and street already exists.";

export async function listBlocks(
  db: Database,
  options: { limit: number; offset: number; search?: string | undefined },
): Promise<{ rows: BlockRow[]; total: number }> {
  /* Partial match on either field, so a half-remembered block number finds it. */
  const filter =
    options.search === undefined || options.search.trim() === ""
      ? undefined
      : or(
          ilike(blocks.name, `%${options.search.trim()}%`),
          ilike(blocks.street, `%${options.search.trim()}%`),
        );

  const rows = await db
    .select()
    .from(blocks)
    .where(filter)
    .orderBy(asc(blocks.street), asc(blocks.name))
    .limit(options.limit)
    .offset(options.offset);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(blocks)
    .where(filter);

  return { rows, total: firstOrThrow(counted, "the block count").total };
}

export async function createBlock(
  db: Database,
  input: { name: string; street: string; postalCode?: string | null | undefined },
): Promise<BlockRow> {
  try {
    const inserted = await db
      .insert(blocks)
      .values({
        name: input.name.trim(),
        street: input.street.trim(),
        postalCode: input.postalCode ?? null,
      })
      .returning();
    return firstOrThrow(inserted, "the block insert");
  } catch (error) {
    if (isDuplicateBlock(error)) {
      throw new ConflictError("conflict", DUPLICATE_MESSAGE);
    }
    throw error;
  }
}

export async function updateBlock(
  db: Database,
  id: string,
  /*
   * Explicit `| undefined` throughout: exactOptionalPropertyTypes is on, and
   * the generated request types model an omitted field that way.
   */
  changes: {
    name?: string | undefined;
    street?: string | undefined;
    postalCode?: string | null | undefined;
  },
): Promise<BlockRow> {
  const values: Record<string, unknown> = {};
  if (changes.name !== undefined) values["name"] = changes.name.trim();
  if (changes.street !== undefined) values["street"] = changes.street.trim();
  if (changes.postalCode !== undefined) values["postalCode"] = changes.postalCode;

  try {
    const updated = await db.update(blocks).set(values).where(eq(blocks.id, id)).returning();
    const row = updated[0];
    if (!row) {
      throw new NotFoundError("No such block.");
    }
    return row;
  } catch (error) {
    if (isDuplicateBlock(error)) {
      throw new ConflictError("conflict", DUPLICATE_MESSAGE);
    }
    throw error;
  }
}
