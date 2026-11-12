import { getDatabase } from "@/db/client";
import {
  zCreateUserBody,
  zCreateUserResponse,
  zListUsersQuery,
  zListUsersResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { googleSignInEnabled } from "@/auth/google";
import { currentUser } from "@/server/auth/session";
import { toUser } from "@/server/users/serialise";
import { createUser, listUsers } from "@/server/users/service";

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

/*
 * There is no invite email in this app. Someone added with a password has it
 * handed over in person; without one they sign in with Google only (#14).
 * hashPassword refuses a weak one before anything is written, so a rejected
 * password leaves no half-made account.
 */
export const POST = withContract(
  {
    operationId: "createUser",
    body: zCreateUserBody,
    responses: { 201: zCreateUserResponse },
  },
  async ({ body }) => {
    await currentUser("admin");
    const user = await createUser(
      getDatabase(),
      { email: body.email, password: body.password, name: body.name, role: body.role },
      googleSignInEnabled(),
    );
    return { status: 201, body: toUser(user) };
  },
);
