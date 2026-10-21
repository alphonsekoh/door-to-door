import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FollowUpDoor, UnitNumber } from "@/components/unit-number";

describe("UnitNumber", () => {
  it("is one piece that never wraps, so the hyphen cannot split it", () => {
    render(
      <p>
        Saved <UnitNumber value="#06-203" />.
      </p>,
    );
    const unit = screen.getByText("#06-203");
    expect(unit.parentElement).toHaveTextContent(/^Saved #06-203\.$/);
    expect(unit).toHaveClass("whitespace-nowrap");
  });
});

describe("FollowUpDoor", () => {
  it("names the block and the unit", () => {
    const { container } = render(
      <FollowUpDoor note={{ blockName: "123", unitNumber: "#05-123" }} />,
    );
    expect(container).toHaveTextContent(/^Blk 123 · #05-123$/);
    expect(screen.getByText("#05-123")).toHaveClass("whitespace-nowrap");
  });
});
