import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { runRetention } from "@/server/privacy/retention";

describe("runRetention", () => {
  it("passes on a failure that is not another run holding the lease", async () => {
    // A dropped connection must not read as "a run is already under way".
    const reset = new Error("connection reset");
    const fake = {
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.reject(reset) }) }),
    } as unknown as Database;
    await expect(runRetention(fake, { now: new Date(), toleranceMs: 0 })).rejects.toBe(reset);
  });
});
