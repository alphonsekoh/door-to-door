import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import {
  zGetCurrentUserResponse,
  zUpdateOwnProfileBody,
  zUpdateOwnProfileResponse,
} from "@/generated/zod.gen";
import { requireOwnAccount } from "@/server/auth/guards";
import { AccountBlockedError } from "@/server/http/errors";
import { withContract } from "@/server/http/contract";
import { toUser } from "@/server/users/serialise";
import { getUser, updateOwnName } from "@/server/users/service";

/*
 * The first contract-backed handler, and the shape every later one follows:
 * withContract validates in both directions, and the guard runs inside it so
 * an ApiError becomes the documented response.
 *
 * The only operations someone not yet approved may call (#249): this is how
 * the app learns to show them the waiting page, and where they correct the
 * name Google gave them. requireOwnAccount still refuses the signed-out and
 * the deactivated.
 */
export const GET = withContract(
  {
    operationId: "getCurrentUser",
    responses: { 200: zGetCurrentUserResponse },
  },
  async () => {
    const current = requireOwnAccount(await currentSession());
    const user = await getUser(getDatabase(), current.id);
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
    const current = requireOwnAccount(await currentSession());
    /* Rejected: they wait for nobody, so there is no name to correct. */
    if (current.approval === "blocked") {
      throw new AccountBlockedError();
    }
    const user = await updateOwnName(getDatabase(), current.id, body.name);
    return { status: 200, body: toUser(user) };
  },
);
