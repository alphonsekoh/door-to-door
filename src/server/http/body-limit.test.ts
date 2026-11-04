import { describe, expect, it } from "vitest";
import {
  zCreateSessionRequest,
  zCreateVisitRequest,
  zSyncVisitsBody,
  zVisitSyncItem,
} from "@/generated/zod.gen";
import {
  DEFAULT_BODY_LIMIT_BYTES,
  PROXY_BODY_LIMIT_BYTES,
  SYNC_BODY_LIMIT_BYTES,
} from "@/server/http/body-limit";

/*
 * The caps against what the contract admits (#126). Written in a 3-byte
 * character, the most UTF-8 a maxLength (counted in UTF-16 units) can hold.
 */
const wide = (length: number) => "中".repeat(length);
const bytes = (body: unknown) => new TextEncoder().encode(JSON.stringify(body)).byteLength;
const uuid = (n: number) => `01960000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-03-14T10:00:00.000Z";

/* Every string at its maxLength, and the longest enum values. */
const longestItem = (n: number) => ({
  id: uuid(n),
  blockId: uuid(1_000_000),
  unitNumber: wide(32),
  sessionId: uuid(2_000_000),
  interestLevel: "no_response",
  description: wide(4000),
  clientCreatedAt: at,
  updatedAt: at,
  name: wide(160),
  contact: wide(64),
  religion: "freethinker",
});

describe("the sync cap", () => {
  it("holds a full batch with every field at its longest", () => {
    const batch = { sentAt: at, items: Array.from({ length: 100 }, (_, n) => longestItem(n)) };
    expect(zSyncVisitsBody.safeParse(batch).success).toBe(true);
    expect(bytes(batch)).toBeLessThanOrEqual(SYNC_BODY_LIMIT_BYTES);
  });

  it.each(["unitNumber", "description", "name", "contact"] as const)(
    "is measured with %s at the contract's maxLength",
    (field) => {
      const item = longestItem(0);
      expect(zVisitSyncItem.safeParse(item).success).toBe(true);
      expect(zVisitSyncItem.safeParse({ ...item, [field]: `${item[field]}中` }).success).toBe(
        false,
      );
    },
  );
});

describe("the default cap", () => {
  it("holds the largest body any other operation takes, but team creation", () => {
    // memberIds is uncapped (D-74-15): the body cap is what bounds it.
    const visit = {
      id: uuid(1),
      blockId: uuid(2),
      unitNumber: wide(32),
      interestLevel: "no_response",
      description: wide(4000),
      memberId: uuid(3),
      clientCreatedAt: at,
      name: wide(160),
      contact: wide(64),
      religion: "freethinker",
    };
    const session = {
      title: wide(160),
      kind: "follow_up",
      blockIds: Array.from({ length: 50 }, (_, n) => uuid(n)),
      householdIds: Array.from({ length: 200 }, (_, n) => uuid(n + 100)),
    };
    expect(zCreateVisitRequest.safeParse(visit).success).toBe(true);
    expect(zCreateSessionRequest.safeParse(session).success).toBe(true);
    expect(Math.max(bytes(visit), bytes(session))).toBeLessThan(DEFAULT_BODY_LIMIT_BYTES / 10);
  });

  it("keeps one team's memberIds below what one insert could bind", () => {
    // Each id costs at least its quotes and a comma; three columns a member.
    const perId = bytes([uuid(1), uuid(2)]) - bytes([uuid(1)]);
    expect(perId).toBe(39);
    expect(Math.floor(DEFAULT_BODY_LIMIT_BYTES / perId)).toBeLessThan(Math.floor(65_535 / 3));
  });
});

describe("the proxy's cut", () => {
  it("is the 2 MB D-120-7 chose, as Next reads it", () => {
    expect(PROXY_BODY_LIMIT_BYTES).toBe(2 * 1024 * 1024);
  });

  it("stays far enough above the sync cap that a cut body is still over it", () => {
    expect(SYNC_BODY_LIMIT_BYTES + 512 * 1024).toBeLessThanOrEqual(PROXY_BODY_LIMIT_BYTES);
    expect(DEFAULT_BODY_LIMIT_BYTES).toBeLessThan(SYNC_BODY_LIMIT_BYTES);
  });
});
