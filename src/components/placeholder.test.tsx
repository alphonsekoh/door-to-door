import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Placeholder } from "@/components/placeholder";

describe("Placeholder", () => {
  it("describes what will replace it", () => {
    render(<Placeholder issue={24}>The active session and its blocks.</Placeholder>);
    expect(screen.getByText("The active session and its blocks.")).toBeInTheDocument();
  });

  it("names the issue that delivers the real screen", () => {
    render(<Placeholder issue={24}>Anything.</Placeholder>);
    expect(screen.getByText("Arrives in issue #24")).toBeInTheDocument();
  });
});
