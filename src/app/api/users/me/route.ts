import { eq } from "drizzle-orm";
import { auth } from "@/../auth";
import { getDatabase } from "@/db/client";
import { users } from "@/db/schema";
import { zGetCurrentUserResponse } from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { withContract } from "@/server/http/contract";
import { NotFoundError } from "@/server/http/errors";

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
    const session = await auth();
    const current = requireUser(session);

    const rows = await getDatabase()
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        role: users.role,
        deactivatedAt: users.deactivatedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, current.id))
      .limit(1);

    const user = rows[0];
    if (!user) {
      // The token names a user that no longer exists.
      throw new NotFoundError("Your account no longer exists.");
    }

    return {
      status: 200,
      body: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      },
    };
  },
);
