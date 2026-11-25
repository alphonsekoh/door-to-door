import { getDatabase } from "@/db/client";
import {
  zClearContactWithdrawnPath,
  zClearContactWithdrawnResponse,
  zMarkContactWithdrawnPath,
  zMarkContactWithdrawnResponse,
} from "@/generated/zod.gen";
import { currentUser } from "@/server/auth/session";
import { withContract } from "@/server/http/contract";
import { clearContactWithdrawn, markContactWithdrawn } from "@/server/privacy/contact-withdrawal";
import { toHousehold } from "@/server/visits/serialise";

/* Anyone signed in may mark it: marking only ever stops the team using the contact (#279). */
export const POST = withContract(
  {
    operationId: "markContactWithdrawn",
    path: zMarkContactWithdrawnPath,
    responses: { 200: zMarkContactWithdrawnResponse },
  },
  async ({ path }) => {
    await currentUser();
    return {
      status: 200,
      body: toHousehold(await markContactWithdrawn(getDatabase(), path.id, new Date())),
    };
  },
);

/* Putting a contact back in use is an admin's decision. */
export const DELETE = withContract(
  {
    operationId: "clearContactWithdrawn",
    path: zClearContactWithdrawnPath,
    responses: { 200: zClearContactWithdrawnResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    return {
      status: 200,
      body: toHousehold(await clearContactWithdrawn(getDatabase(), path.id)),
    };
  },
);
