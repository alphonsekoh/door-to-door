import { getDatabase } from "@/db/client";
import {
  zGetUserPath,
  zGetUserResponse,
  zUpdateUserBody,
  zUpdateUserPath,
  zUpdateUserResponse,
} from "@/generated/zod.gen";
import { requireChanges, withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toUser } from "@/server/users/serialise";
import { getUser, updateUser } from "@/server/users/service";

/* One member, for their page on Admin > Team (#125). Deactivated ones included. */
export const GET = withContract(
  {
    operationId: "getUser",
    path: zGetUserPath,
    responses: { 200: zGetUserResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    return { status: 200, body: toUser(await getUser(getDatabase(), path.id)) };
  },
);

/*
 * Role and activation. The self-demotion, self-deactivation and last-admin
 * rules live in the service, not here: they are about the state of the team,
 * and a second caller would otherwise have to remember them.
 */
export const PATCH = withContract(
  {
    operationId: "updateUser",
    path: zUpdateUserPath,
    body: zUpdateUserBody,
    responses: { 200: zUpdateUserResponse },
  },
  async ({ path, body }) => {
    const admin = await currentUser("admin");
    requireChanges(body);

    const user = await updateUser(
      getDatabase(),
      path.id,
      {
        ...(body.role === undefined ? {} : { role: body.role }),
        ...(body.deactivated === undefined ? {} : { deactivated: body.deactivated }),
      },
      admin.id,
    );

    return { status: 200, body: toUser(user) };
  },
);
