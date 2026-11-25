import type { ErasureRequest, RetentionRun } from "@/generated/types.gen";
import { toBlock } from "@/server/blocks/serialise";
import type { ErasureRequestView, RetentionRunView } from "@/server/privacy/requests";
import { toHousehold } from "@/server/visits/serialise";

export function toErasureRequest(view: ErasureRequestView): ErasureRequest {
  return {
    id: view.id,
    kind: view.kind,
    household: view.household === null ? null : toHousehold(view.household),
    block: view.block === null ? null : toBlock(view.block),
    account: view.account,
    requestedAt: view.requestedAt.toISOString(),
    loggedBy: view.loggedBy,
    loggedAt: view.loggedAt.toISOString(),
    erasedAt: view.erasedAt?.toISOString() ?? null,
    erasedBy: view.erasedBy,
  };
}

export function toRetentionRun(run: RetentionRunView): RetentionRun {
  return {
    ranAt: run.ranAt.toISOString(),
    households: run.households,
    accounts: run.accounts,
    signIns: run.signIns,
    more: run.more,
  };
}
