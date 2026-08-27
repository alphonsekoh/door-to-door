import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { Role } from "@/db/schema";
import { users } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";

/*
 * Reads over the team.
 *
 * Deactivated users are excluded by default but never deleted: their records
 * stay attributed to them, because history has to survive someone leaving.
 */

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  deactivatedAt: Date | null;
  createdAt: Date;
};

const columns = {
  id: users.id,
  email: users.email,
  name: users.name,
  image: users.image,
  role: users.role,
  deactivatedAt: users.deactivatedAt,
  createdAt: users.createdAt,
};

export async function listUsers(
  db: Database,
  options: {
    role?: Role | undefined;
    includeDeactivated: boolean;
    limit: number;
    offset: number;
  },
): Promise<{ rows: UserRow[]; total: number }> {
  const conditions = [
    ...(options.role === undefined ? [] : [eq(users.role, options.role)]),
    ...(options.includeDeactivated ? [] : [isNull(users.deactivatedAt)]),
  ];
  const filter = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select(columns)
    .from(users)
    /* By name so a picker reads alphabetically; email breaks the tie and is
       never null, so the order is stable across pages. */
    .orderBy(asc(users.name), asc(users.email))
    .where(filter)
    .limit(options.limit)
    .offset(options.offset);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(filter);

  return { rows, total: firstOrThrow(counted, "the user count").total };
}
