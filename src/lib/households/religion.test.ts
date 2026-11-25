import { describe, expect, it } from "vitest";
import { RELIGIONS, RELIGION_LABEL } from "@/lib/households/religion";

describe("religion labels", () => {
  it("names every religion once, in the picker's order", () => {
    expect(RELIGIONS.map((option) => option.label)).toEqual([
      "Buddhist",
      "Christian",
      "Hindu",
      "Freethinker",
      "Others",
    ]);
    expect(RELIGION_LABEL.hindu).toBe("Hindu");
  });
});
