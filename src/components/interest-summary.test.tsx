import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InterestSummary } from "@/components/interest-summary";

describe("InterestSummary", () => {
  it("states the outcomes in words and numbers, not only as a bar", () => {
    render(<InterestSummary interest={{ low: 1, medium: 0, high: 2, noResponse: 7 }} />);
    expect(screen.getByText("High 2 · Low 1 · No answer 7")).toBeInTheDocument();
  });

  it("renders nothing for an outing with no records", () => {
    const { container } = render(
      <InterestSummary interest={{ low: 0, medium: 0, high: 0, noResponse: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("sizes each band by its share of the total", () => {
    const { container } = render(
      <InterestSummary interest={{ low: 0, medium: 0, high: 1, noResponse: 3 }} />,
    );
    const bands = container.querySelectorAll("span[style]");
    expect(bands[0]).toHaveStyle({ width: "25%" });
    expect(bands[1]).toHaveStyle({ width: "75%" });
  });

  it("hides the bar from assistive tech, since the counts already say it", () => {
    const { container } = render(
      <InterestSummary interest={{ low: 1, medium: 0, high: 0, noResponse: 0 }} />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
