import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InterestChip } from "@/components/interest-chip";
import type { InterestLevel } from "@/generated/types.gen";

describe("InterestChip", () => {
  it.each<[InterestLevel, string]>([
    ["high", "High"],
    ["medium", "Medium"],
    ["low", "Low"],
    ["no_response", "No answer"],
  ])("labels %s in words, not only in colour", (level, label) => {
    // The greyscale requirement: a stairwell, bright sun or colour blindness
    // must not be able to turn "High" into "Low".
    render(<InterestChip level={level} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
