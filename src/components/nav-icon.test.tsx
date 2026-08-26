import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavIcon } from "@/components/nav-icon";

const pathOf = (container: HTMLElement) => container.querySelector("path")?.getAttribute("d");

describe("NavIcon", () => {
  it("is hidden from assistive tech, since the label carries the meaning", () => {
    const { container } = render(<NavIcon name="/" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws a distinct glyph per destination", () => {
    const drawn = ["/", "/history", "/follow-ups", "/account"].map(
      (name) => pathOf(render(<NavIcon name={name} />).container) ?? "",
    );
    expect(new Set(drawn).size).toBe(4);
  });

  it("falls back to the home glyph for an unknown name", () => {
    const home = pathOf(render(<NavIcon name="/" />).container);
    const unknown = pathOf(render(<NavIcon name="/nope" />).container);
    expect(unknown).toBe(home);
  });
});
