import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("AppShell", () => {
  it("renders page content inside the main landmark", () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("Page body");
  });

  it("renders the primary navigation alongside the content", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});
