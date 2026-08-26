import { expect, it } from "vitest";
import { probe } from "@/lib/probe";

it("covers only one branch, deliberately", () => {
  expect(probe(true)).toBe("covered");
});
