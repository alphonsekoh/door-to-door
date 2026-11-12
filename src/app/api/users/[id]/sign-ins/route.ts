import { z } from "zod";
import { getDatabase } from "@/db/client";
import {
  zEndUserSignInsPath,
  zListUserSignInsPath,
  zListUserSignInsResponse,
} from "@/generated/zod.gen";
import { sameUuid } from "@/lib/uuid";
import { withContract } from "@/server/http/contract";
import { currentSignIn } from "@/server/auth/session";
import { endAllSignIns, listSignIns } from "@/server/auth/sign-ins";
import { getUser } from "@/server/users/service";

/*
 * Where a member is signed in, for an admin (#125). Members never see this
 * list, their own included: the account screen stays as it is.
 */
export const GET = withContract(
  {
    operationId: "listUserSignIns",
    path: zListUserSignInsPath,
    responses: { 200: zListUserSignInsResponse },
  },
  async ({ path }) => {
    const { signInId } = await currentSignIn("admin");
    const db = getDatabase();
    await getUser(db, path.id);
    const signIns = await listSignIns(db, path.id, signInId);
    return {
      status: 200,
      body: {
        data: signIns.map((signIn) => ({
          ...signIn,
          signedInAt: signIn.signedInAt.toISOString(),
          lastUsedAt: signIn.lastUsedAt.toISOString(),
        })),
      },
    };
  },
);

/*
 * Signs a member out everywhere. On your own account the sign-in making the
 * request is kept: this phone is signed out with Account's Sign out, which
 * also clears what the phone holds.
 */
export const DELETE = withContract(
  {
    operationId: "endUserSignIns",
    path: zEndUserSignInsPath,
    responses: { 204: z.undefined() },
  },
  async ({ path }) => {
    const { user, signInId } = await currentSignIn("admin");
    const db = getDatabase();
    await getUser(db, path.id);
    await endAllSignIns(db, path.id, sameUuid(path.id, user.id) ? signInId : null);
    return { status: 204 };
  },
);
