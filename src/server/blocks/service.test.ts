import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { untouchableDatabase } from "@/db/testing";
import {
  createBlock,
  updateBlock,
  isDuplicateBlock,
  BLOCK_NAME_STREET_CONSTRAINT,
} from "@/server/blocks/service";

describe("isDuplicateBlock", () => {
  it("recognises the natural-key violation through Drizzle's wrapper", () => {
    expect(
      isDuplicateBlock(
        Object.assign(new Error("Failed query"), {
          cause: { constraint: BLOCK_NAME_STREET_CONSTRAINT },
        }),
      ),
    ).toBe(true);
  });

  it("does not claim an unrelated failure", () => {
    expect(isDuplicateBlock(new Error("connection reset"))).toBe(false);
  });
});

describe("createBlock error handling", () => {
  it("rethrows an unrelated database failure rather than calling it a duplicate", () => {
    /*
     * A connection reset reported as "that block already exists" would send an
     * admin hunting for a block that is not there.
     */
    const stub = {
      insert: () => ({
        values: () => ({ returning: () => Promise.reject(new Error("connection reset")) }),
      }),
    } as unknown as Database;

    return expect(createBlock(stub, { name: "123", street: "Test Ave" })).rejects.toThrow(
      "connection reset",
    );
  });
});

describe("a blank name or street", () => {
  const untouchable = untouchableDatabase();
  const blank = (path: string) => ({
    code: "validation_failed",
    details: [{ path, message: "Must contain something other than spaces." }],
  });

  it("is refused by createBlock before anything is written", async () => {
    await expect(
      createBlock(untouchable, { name: "  ", street: "Test Ave" }),
    ).rejects.toMatchObject(blank("/name"));
    await expect(createBlock(untouchable, { name: "123", street: "\t" })).rejects.toMatchObject(
      blank("/street"),
    );
  });

  it("is refused by updateBlock before anything is written", async () => {
    await expect(updateBlock(untouchable, "b1", { name: " " })).rejects.toMatchObject(
      blank("/name"),
    );
    await expect(updateBlock(untouchable, "b1", { street: "   " })).rejects.toMatchObject(
      blank("/street"),
    );
  });
});
