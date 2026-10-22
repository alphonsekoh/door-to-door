import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useLinkStatus = vi.hoisted(() => vi.fn());
vi.mock("next/link", () => ({ useLinkStatus }));

import { LinkPending } from "@/components/ui/link-pending";

beforeEach(() => {
  useLinkStatus.mockReset();
});

describe("LinkPending", () => {
  it("shows while the route is on its way", () => {
    useLinkStatus.mockReturnValue({ pending: true });
    const { container } = render(<LinkPending />);
    const hint = container.firstElementChild;
    expect(hint).toHaveAttribute("data-pending", "true");
    expect(hint).toHaveClass("opacity-100");
    // Decoration only: the link's own name is what is announced.
    expect(hint).toHaveAttribute("aria-hidden", "true");
  });

  it("stays laid out but invisible otherwise, so nothing moves when it appears", () => {
    useLinkStatus.mockReturnValue({ pending: false });
    const { container } = render(<LinkPending />);
    expect(container.firstElementChild).toHaveClass("opacity-0");
  });
});
