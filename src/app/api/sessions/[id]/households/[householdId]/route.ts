import { z } from "zod";
import { getDatabase } from "@/db/client";
import { zRemoveSessionHouseholdPath } from "@/generated/zod.gen";
import { currentUser } from "@/server/auth/session";
import { withContract } from "@/server/http/contract";
import { removeSessionHousehold } from "@/server/sessions/households";

/* The household's notes stay on the follow-up list for a later session. */
export const DELETE = withContract(
  {
    operationId: "removeSessionHousehold",
    path: zRemoveSessionHouseholdPath,
    responses: { 204: z.undefined() },
  },
  async ({ path }) => {
    await currentUser("admin");
    await removeSessionHousehold(getDatabase(), path.id, path.householdId);
    return { status: 204 };
  },
);
