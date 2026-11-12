import { z } from "zod";
import { getDatabase } from "@/db/client";
import { zEndUserSignInPath } from "@/generated/zod.gen";
import { sameUuid } from "@/lib/uuid";
import { withContract } from "@/server/http/contract";
import { ConflictError } from "@/server/http/errors";
import { currentSignIn } from "@/server/auth/session";
import { endOneSignIn } from "@/server/auth/sign-ins";
import { getUser } from "@/server/users/service";

/* Signs a member out of one device (#125); their others carry on. */
export const DELETE = withContract(
  {
    operationId: "endUserSignIn",
    path: zEndUserSignInPath,
    responses: { 204: z.undefined() },
  },
  async ({ path }) => {
    const { user, signInId } = await currentSignIn("admin");
    if (sameUuid(path.id, user.id) && sameUuid(path.signInId, signInId)) {
      throw new ConflictError("conflict", "To sign out of this phone, use Sign out on Account.");
    }
    const db = getDatabase();
    await getUser(db, path.id);
    await endOneSignIn(db, path.id, path.signInId);
    return { status: 204 };
  },
);
