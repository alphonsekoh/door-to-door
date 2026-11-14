import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FollowUpDoor, UnitNumber, WholeWords } from "@/components/ui/unit-number";

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

describe("WholeWords", () => {
  it("keeps each hyphenated word on one line, and leaves the rest free to wrap", () => {
    const { container } = render(
      <p>
        <WholeWords text="Undone. Follow-up reopened at #05-123, and 2 follow-ups." />
      </p>,
    );
    // The words read exactly as given: nothing is swapped for a non-breaking hyphen.
    expect(container).toHaveTextContent(
      /^Undone\. Follow-up reopened at #05-123, and 2 follow-ups\.$/,
    );
    const kept = [...container.querySelectorAll(".whitespace-nowrap")].map(
      (word) => word.textContent,
    );
    expect(kept).toEqual(["Follow-up", "#05-123,", "follow-ups."]);
  });

  it("wraps nothing in text with no hyphen", () => {
    const { container } = render(
      <p>
        <WholeWords text="Not undone. Check your signal and try again." />
      </p>,
    );
    expect(container.querySelector(".whitespace-nowrap")).toBeNull();
    expect(container).toHaveTextContent("Not undone. Check your signal and try again.");
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
