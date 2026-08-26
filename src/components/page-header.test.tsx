import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
