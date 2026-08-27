import { getDatabase } from "@/db/client";
import { zListUsersQuery, zListUsersResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { toUser } from "@/server/users/serialise";
import { listUsers } from "@/server/users/service";

/*
 * The team. Admin-only: it exposes email addresses and who is deactivated.
 *
 * Implemented here rather than with member management (#31) because recording
 * on someone's behalf needs a picker, and a picker needs the list.
 */
export const GET = withContract(
  {
    operationId: "listUsers",
    query: zListUsersQuery,
    responses: { 200: zListUsersResponse },
  },
  async ({ query }) => {
    await currentUser("admin");
    const { limit, offset, includeDeactivated } = query;

    const { rows, total } = await listUsers(getDatabase(), {
      limit,
      offset,
      includeDeactivated,
      ...(query.role === undefined ? {} : { role: query.role }),
    });

    return {
      status: 200,
      body: {
        data: rows.map(toUser),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);
