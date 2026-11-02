import { describe, expect, it } from "vitest";
import { untouchableDatabase } from "@/db/testing";
import { ValidationError } from "@/server/http/errors";
import { createVisit, upsertHousehold } from "@/server/visits/service";

const untouchable = untouchableDatabase();

const clock = { now: new Date("2026-03-14T12:00:00.000Z"), toleranceMs: 300_000 };
const blank = { path: "/unitNumber", message: "Must contain something other than spaces." };

describe("a blank unit number", () => {
  it("is refused by createVisit before anything is read", async () => {
    const recording = createVisit(
      untouchable,
      {
        id: "01960000-0000-7000-8000-000000000001",
        blockId: "b1",
        unitNumber: " 　 ",
        interestLevel: "low",
        memberId: "u1",
        // In the future too: the unit is judged before the clock.
        clientCreatedAt: "2099-01-01T00:00:00.000Z",
      },
      clock,
      { role: "admin" },
    );
    await expect(recording).rejects.toBeInstanceOf(ValidationError);
    await expect(recording).rejects.toMatchObject({ details: [blank] });
  });

  it("is refused by upsertHousehold for any other caller", async () => {
    await expect(
      upsertHousehold(untouchable, { blockId: "b1", unitNumber: "   " }),
    ).rejects.toMatchObject({ code: "validation_failed", details: [blank] });
  });
});
