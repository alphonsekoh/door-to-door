import { describe, expect, it } from "vitest";
import { firstOrThrow } from "@/server/db-utils";
import { InternalError } from "@/server/http/errors";

describe("firstOrThrow", () => {
  it("returns the first row", () => {
    expect(firstOrThrow([{ total: 7 }], "the count")).toEqual({ total: 7 });
  });

  it("ignores anything after the first", () => {
    expect(firstOrThrow([1, 2, 3], "the query")).toBe(1);
  });

  it("throws when the query returned nothing", () => {
    expect(() => firstOrThrow([], "the count")).toThrow(InternalError);
  });

  it("names what was expected, so the log points somewhere", () => {
    expect(() => firstOrThrow([], "the session insert")).toThrow(/the session insert/);
  });
});
