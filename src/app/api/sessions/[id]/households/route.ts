import { getDatabase } from "@/db/client";
import {
  zAddSessionHouseholdsBody,
  zAddSessionHouseholdsPath,
  zAddSessionHouseholdsResponse,
  zListSessionHouseholdsPath,
  zListSessionHouseholdsResponse,
} from "@/generated/zod.gen";
import { currentUser } from "@/server/auth/session";
import { toBlock } from "@/server/blocks/serialise";
import { withContract } from "@/server/http/contract";
import {
  type SessionHouseholdRow,
  addSessionHouseholds,
  assertFollowUpSession,
  listSessionHouseholds,
} from "@/server/sessions/households";
import { getSession } from "@/server/sessions/service";
import { toFollowUp, toHousehold } from "@/server/visits/serialise";

function toSessionHousehold(row: SessionHouseholdRow) {
  return {
    household: toHousehold(row.household),
    block: toBlock(row.block),
    notes: row.notes.map(toFollowUp),
    onList: row.onList,
    visitedInSession: row.visitedInSession,
  };
}

/* Admin only: the picks are how an admin prepares and steers the session. */
export const GET = withContract(
  {
    operationId: "listSessionHouseholds",
    path: zListSessionHouseholdsPath,
    responses: { 200: zListSessionHouseholdsResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    const db = getDatabase();
    const session = await getSession(db, path.id);
    assertFollowUpSession(session);
    const rows = await listSessionHouseholds(db, session);
    return { status: 200, body: { data: rows.map(toSessionHousehold) } };
  },
);

export const POST = withContract(
  {
    operationId: "addSessionHouseholds",
    path: zAddSessionHouseholdsPath,
    body: zAddSessionHouseholdsBody,
    responses: { 200: zAddSessionHouseholdsResponse },
  },
  async ({ path, body }) => {
    await currentUser("admin");
    const db = getDatabase();
    await addSessionHouseholds(db, path.id, body.householdIds);
    const rows = await listSessionHouseholds(db, await getSession(db, path.id));
    return { status: 200, body: { data: rows.map(toSessionHousehold) } };
  },
);
