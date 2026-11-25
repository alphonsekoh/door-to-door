import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  blocks,
  erasureRequests,
  households,
  retentionRuns,
  users,
  type ErasureRequestRow,
} from "@/db/schema";
import { checkNotAhead, type Clock } from "@/lib/clock";
import { firstOrThrow, getOrThrow, isConstraintViolation, presentOrThrow } from "@/server/db-utils";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/http/errors";
import type { BlockRow } from "@/server/blocks/service";
import { assertHoldsSomething, eraseAccount, eraseHousehold } from "@/server/privacy/erasure";
import type { HouseholdRow } from "@/server/visits/service";

/*
 * Erasure requests (#279): logged by a member or an admin, carried out by an
 * admin. A request holds no personal data of its own; who asked is the
 * subject itself.
 */

export type Actor = { id: string; role: "admin" | "member" };

export type PersonRef = { id: string; name: string | null; image: string | null };

export type ErasureRequestView = {
  id: string;
  kind: "household" | "account";
  household: HouseholdRow | null;
  block: BlockRow | null;
  account: PersonRef | null;
  requestedAt: Date;
  loggedBy: PersonRef;
  loggedAt: Date;
  erasedAt: Date | null;
  erasedBy: PersonRef | null;
};

export type RetentionRunView = {
  ranAt: Date;
  households: number;
  accounts: number;
  signIns: number;
  more: boolean;
};

const OPEN_HOUSEHOLD = "erasure_requests_one_open_household_idx";
const OPEN_USER = "erasure_requests_one_open_user_idx";

/* Three reads however many requests: their units with blocks, and every person named. */
export async function viewRequests(
  db: Database,
  rows: readonly ErasureRequestRow[],
): Promise<ErasureRequestView[]> {
  if (rows.length === 0) return [];

  const householdIds = rows.flatMap((row) => (row.householdId === null ? [] : [row.householdId]));
  const userIds = [
    ...new Set(
      rows.flatMap((row) => [
        row.loggedBy,
        ...(row.userId === null ? [] : [row.userId]),
        ...(row.erasedBy === null ? [] : [row.erasedBy]),
      ]),
    ),
  ];
  const [units, people] = await Promise.all([
    householdIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ household: households, block: blocks })
          .from(households)
          .innerJoin(blocks, eq(blocks.id, households.blockId))
          .where(inArray(households.id, householdIds)),
    db
      .select({ id: users.id, name: users.name, image: users.image })
      .from(users)
      .where(inArray(users.id, userIds)),
  ]);
  const unitById = new Map(units.map((unit) => [unit.household.id, unit]));
  const personById = new Map(people.map((person) => [person.id, person]));
  const person = (id: string) => getOrThrow(personById, id, "a person a request names");

  return rows.map((row) => {
    const unit = row.householdId === null ? null : getOrThrow(unitById, row.householdId, "a unit");
    return {
      id: row.id,
      kind: unit === null ? "account" : "household",
      household: unit?.household ?? null,
      block: unit?.block ?? null,
      account: row.userId === null ? null : person(row.userId),
      requestedAt: row.requestedAt,
      loggedBy: person(row.loggedBy),
      loggedAt: row.loggedAt,
      erasedAt: row.erasedAt,
      erasedBy: row.erasedBy === null ? null : person(row.erasedBy),
    };
  });
}

async function viewOne(db: Database, id: string): Promise<ErasureRequestView> {
  const rows = await db.select().from(erasureRequests).where(eq(erasureRequests.id, id));
  return firstOrThrow(await viewRequests(db, rows), "the request");
}

export type NewErasureRequest = {
  kind: "household" | "account";
  id: string;
  requestedAt?: string | undefined;
};

/*
 * 201 for a new request, and the open one unchanged when there already is one:
 * the partial unique indexes decide, so two admins logging the same person
 * at once cannot make two.
 */
export async function createErasureRequest(
  db: Database,
  input: NewErasureRequest,
  actor: Actor,
  clock: Clock,
): Promise<{ request: ErasureRequestView; created: boolean }> {
  if (input.kind === "account" && actor.role !== "admin") {
    throw new ForbiddenError("Only an admin can log a request to erase an account.");
  }
  const requestedAt = input.requestedAt === undefined ? clock.now : new Date(input.requestedAt);
  if (checkNotAhead(requestedAt, clock) !== null) {
    throw new ValidationError("The request failed validation.", [
      { path: "/requestedAt", message: "When they asked cannot be in the future." },
    ]);
  }

  if (input.kind === "household") {
    const found = await db
      .select({ id: households.id, erasedAt: households.erasedAt })
      .from(households)
      .where(eq(households.id, input.id));
    const household = found[0];
    if (!household) throw new NotFoundError("No such household.");
    await assertHoldsSomething(db, household.id, household);
  } else {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.id), isNull(users.erasedAt)));
    if (found.length === 0) throw new NotFoundError("No such user.");
  }

  try {
    const inserted = await db
      .insert(erasureRequests)
      .values({
        ...(input.kind === "household" ? { householdId: input.id } : { userId: input.id }),
        requestedAt,
        loggedBy: actor.id,
      })
      .returning({ id: erasureRequests.id });
    const id = firstOrThrow(inserted, "the request insert").id;
    return { request: await viewOne(db, id), created: true };
  } catch (error) {
    if (!isConstraintViolation(error, OPEN_HOUSEHOLD) && !isConstraintViolation(error, OPEN_USER)) {
      throw error;
    }
    const open = await db
      .select({ id: erasureRequests.id })
      .from(erasureRequests)
      .where(
        and(
          isNull(erasureRequests.erasedAt),
          eq(
            input.kind === "household" ? erasureRequests.householdId : erasureRequests.userId,
            input.id,
          ),
        ),
      );
    return {
      request: await viewOne(db, firstOrThrow(open, "the open request").id),
      created: false,
    };
  }
}

/*
 * Carries a request out in one transaction. The subject is locked before the
 * request is stamped, in the order the retention job takes them, so the two
 * cannot deadlock; the stamp is conditional, so two admins cannot both carry
 * one out: the second finds it stamped and is told so.
 */
export async function eraseRequest(
  db: Database,
  id: string,
  actor: Actor,
  now: Date,
): Promise<ErasureRequestView> {
  await db.transaction(async (tx) => {
    const found = await tx.select().from(erasureRequests).where(eq(erasureRequests.id, id));
    const request = found[0];
    if (!request) throw new NotFoundError("No such request.");
    const alreadyDone = () =>
      new ConflictError("conflict", "That request has already been carried out.");
    if (request.erasedAt !== null) throw alreadyDone();

    if (request.householdId !== null) {
      await eraseHousehold(tx, request.householdId, now);
    } else {
      // A request with no household names a user: the table's check says so.
      await eraseAccount(tx, presentOrThrow(request.userId, "the account"), actor.id, now);
    }
    const stamped = await tx
      .update(erasureRequests)
      .set({ erasedAt: now, erasedBy: actor.id })
      .where(and(eq(erasureRequests.id, id), isNull(erasureRequests.erasedAt)))
      .returning({ id: erasureRequests.id });
    if (stamped.length === 0) throw alreadyDone();
  });
  return viewOne(db, id);
}

export async function listErasureRequests(
  db: Database,
  options: { status: "open" | "erased"; limit: number; offset: number },
): Promise<{
  rows: ErasureRequestView[];
  total: number;
  lastRun: RetentionRunView | null;
}> {
  const filter =
    options.status === "open"
      ? isNull(erasureRequests.erasedAt)
      : isNotNull(erasureRequests.erasedAt);
  /* The oldest request is the nearest its deadline; carried-out ones read newest first. The id settles a tie (#212). */
  const order =
    options.status === "open"
      ? [asc(erasureRequests.requestedAt), asc(erasureRequests.id)]
      : [desc(erasureRequests.erasedAt), asc(erasureRequests.id)];

  const [page, counted, runs] = await Promise.all([
    db
      .select()
      .from(erasureRequests)
      .where(filter)
      .orderBy(...order)
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(erasureRequests)
      .where(filter),
    db
      .select()
      .from(retentionRuns)
      .where(isNotNull(retentionRuns.finishedAt))
      .orderBy(desc(retentionRuns.finishedAt))
      .limit(1),
  ]);
  const run = runs[0];
  return {
    rows: await viewRequests(db, page),
    total: firstOrThrow(counted, "the request count").total,
    lastRun:
      run === undefined
        ? null
        : {
            ranAt: run.startedAt,
            households: run.households,
            accounts: run.accounts,
            signIns: run.signIns,
            more: run.more,
          },
  };
}
