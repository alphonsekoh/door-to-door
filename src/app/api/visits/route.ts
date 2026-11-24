import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { households, users, visits } from "@/db/schema";
import { attachTeams } from "@/server/teams/access";
import {
  zCreateVisitBody,
  zCreateVisitResponse,
  zListVisitsQuery,
  zListVisitsResponse,
} from "@/generated/zod.gen";
import { currentSession } from "@/server/auth/session";
import { requireUser, resolveMemberScope } from "@/server/auth/guards";
import { firstOrThrow } from "@/server/db-utils";
import { withContract } from "@/server/http/contract";
import { RateLimitedError } from "@/server/http/errors";
import { recordLimiter } from "@/server/visits/rate-limits";
import { toRecordedVisit, toVisit } from "@/server/visits/serialise";
import { currentClock } from "@/server/visits/clock-rules";
import { createVisit, visitColumns } from "@/server/visits/service";
import { notesMarkedDoneBy } from "@/server/follow-ups/marked-by-visit";

export const GET = withContract(
  {
    operationId: "listVisits",
    query: zListVisitsQuery,
    responses: { 200: zListVisitsResponse },
  },
  async ({ query }) => {
    const session = await currentSession();
    const { limit, offset } = query;

    /*
     * Members are scoped to their own records. resolveMemberScope refuses a
     * member naming anyone else, so no parameter combination widens the view.
     */
    const memberId = resolveMemberScope(session, query.memberId);
    const user = requireUser(session);
    const scopeToSelf = user.role !== "admin" || query.memberId !== undefined;

    const db = getDatabase();
    const conditions = [
      ...(scopeToSelf ? [eq(visits.memberId, memberId)] : []),
      ...(query.sessionId === undefined ? [] : [eq(visits.sessionId, query.sessionId)]),
      ...(query.householdId === undefined ? [] : [eq(visits.householdId, query.householdId)]),
      ...(query.blockId === undefined ? [] : [eq(households.blockId, query.blockId)]),
    ];
    const filter = conditions.length > 0 ? and(...conditions) : undefined;

    const found = await db
      .select(visitColumns)
      .from(visits)
      .innerJoin(users, eq(users.id, visits.memberId))
      .innerJoin(households, eq(households.id, visits.householdId))
      .where(filter)
      .orderBy(desc(visits.createdAt))
      .limit(limit)
      .offset(offset);

    const rows = await attachTeams(db, found);

    const counted = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(visits)
      .innerJoin(households, eq(households.id, visits.householdId))
      .where(filter);

    const total = firstOrThrow(counted, "the visit count").total;
    return {
      status: 200,
      body: {
        data: rows.map(toVisit),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);

export const POST = withContract(
  {
    operationId: "createVisit",
    body: zCreateVisitBody,
    responses: { 201: zCreateVisitResponse },
  },
  async ({ body }) => {
    const session = await currentSession();
    /*
     * Authorship is decided here and never again. resolveMemberScope refuses a
     * member naming anyone else, so the only caller who can attribute a visit
     * to someone else is an admin capturing a paper or phoned-in record.
     */
    const memberId = resolveMemberScope(session, body.memberId);
    const user = requireUser(session);
    if (!recordLimiter.consume(user.id).allowed) {
      throw new RateLimitedError("Too many visits recorded. Try again shortly.");
    }
    const db = getDatabase();
    const visit = await createVisit(
      db,
      {
        id: body.id,
        blockId: body.blockId,
        unitNumber: body.unitNumber,
        interestLevel: body.interestLevel,
        description: body.description,
        clientCreatedAt: body.clientCreatedAt,
        name: body.name,
        contact: body.contact,
        religion: body.religion,
        memberId,
      },
      currentClock(),
    );
    return { status: 201, body: toRecordedVisit(visit, await notesMarkedDoneBy(db, visit.id)) };
  },
);
