import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PwaPrompts } from "@/components/pwa-prompts";

const { signedIn } = vi.hoisted(() => ({ signedIn: { value: false } }));
vi.mock("@/lib/use-role", () => ({ useRole: () => ({ isSignedIn: signedIn.value }) }));
vi.mock("@/components/install-prompt", () => ({ InstallPrompt: () => <p>install</p> }));
vi.mock("@/components/update-prompt", () => ({ UpdatePrompt: () => <p>update</p> }));

describe("PwaPrompts", () => {
  it("keeps the install listener alive but shows no update prompt when signed out", () => {
    signedIn.value = false;
    render(<PwaPrompts />);
    expect(screen.getByText("install")).toBeInTheDocument();
    expect(screen.queryByText("update")).toBeNull();
  });

  it("offers both once signed in", () => {
    signedIn.value = true;
    render(<PwaPrompts />);
    expect(screen.getByText("update")).toBeInTheDocument();
  });
});
