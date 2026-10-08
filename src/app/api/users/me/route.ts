import { auth } from "@/../auth";
import { getDatabase } from "@/db/client";
import {
  zGetCurrentUserResponse,
  zUpdateOwnProfileBody,
  zUpdateOwnProfileResponse,
} from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { withContract } from "@/server/http/contract";
import { toUser } from "@/server/users/serialise";
import { getUser, updateOwnName } from "@/server/users/service";

/*
 * The first contract-backed handler, and the shape every later one follows:
 * withContract validates in both directions, and the guard runs inside it so
 * an ApiError becomes the documented response.
 */
export const GET = withContract(
  {
    operationId: "getCurrentUser",
    responses: { 200: zGetCurrentUserResponse },
  },
  async () => {
    const current = requireUser(await auth());
    // The token names a user that no longer exists.
    const user = await getUser(getDatabase(), current.id, "Your account no longer exists.");
    return { status: 200, body: toUser(user) };
  },
);

export const PATCH = withContract(
  {
    operationId: "updateOwnProfile",
    body: zUpdateOwnProfileBody,
    responses: { 200: zUpdateOwnProfileResponse },
  },
  async ({ body }) => {
    const current = requireUser(await auth());
    const user = await updateOwnName(getDatabase(), current.id, body.name);
    return { status: 200, body: toUser(user) };
  },
);
