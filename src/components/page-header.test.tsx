import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "@/components/page-header";

describe("PageHeader", () => {
  it("renders the title as the page heading", () => {
    render(<PageHeader title="Active session" />);
    expect(screen.getByRole("heading", { level: 1, name: "Active session" })).toBeInTheDocument();
  });

  it("renders the subtitle when given", () => {
    render(<PageHeader title="History" subtitle="Sessions you have recorded." />);
    expect(screen.getByText("Sessions you have recorded.")).toBeInTheDocument();
  });

  it("omits the subtitle element entirely when not given", () => {
    const { container } = render(<PageHeader title="History" />);
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("PageHeader back link", () => {
  it("offers a way back to the screen it came from", () => {
    render(<PageHeader title="Blk 123" back={{ href: "/", label: "Session" }} />);
    const link = screen.getByRole("link", { name: "Back to Session" });
    expect(link).toHaveAttribute("href", "/");
  });

  it("has none on a top-level screen", () => {
    render(<PageHeader title="History" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("PageHeader, inline", () => {
  it("keeps the title, the subtitle and the way back, on one row", () => {
    render(
      <PageHeader
        title="Blk 123"
        subtitle="Ang Mo Kio Ave 3"
        back={{ href: "/", label: "Session" }}
        inline
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Blk 123" });
    expect(screen.getByText("Ang Mo Kio Ave 3")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Back to Session" });
    expect(link).toHaveAttribute("href", "/");
    // Side by side in one grid row, not stacked as a large title is.
    expect(heading.closest("header")).toHaveClass("grid");
    // The label gives way to the chevron alone where the row is too tight,
    // and the link is still named for where it goes.
    expect(screen.getByText("Session")).toHaveClass("@max-[6.5rem]:sr-only");
  });

  it("goes back within the page where there is no screen to link to", async () => {
    const onBack = vi.fn();
    render(<PageHeader title="Blk 123" back={{ label: "All blocks", onBack }} inline />);
    // A button, not a link: the offline shell's blocks are in-page state.
    expect(screen.queryByRole("link")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "All blocks" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("holds the title centred without a way back, and no subtitle", () => {
    const { container } = render(<PageHeader title="Record a visit" inline />);
    expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });
});
