import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PwaPrompts } from "@/components/pwa/pwa-prompts";

const { signedIn, hasRecordsToSend } = vi.hoisted(() => ({
  signedIn: { value: false },
  hasRecordsToSend: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("@/lib/use-role", () => ({
  useRole: () => ({ isSignedIn: signedIn.value, userId: signedIn.value ? "ann" : undefined }),
}));
vi.mock("@/lib/sw-update", () => ({ hasRecordsToSend }));
vi.mock("@/components/pwa/install-prompt", () => ({ InstallPrompt: () => <p>install</p> }));
vi.mock("@/components/pwa/update-prompt", () => ({
  UpdatePrompt: ({ hasUnsynced }: { hasUnsynced: () => Promise<boolean> }) => (
    <button type="button" onClick={() => void hasUnsynced()}>
      update
    </button>
  ),
}));

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

  it("holds an update back only for the signed-in member's records still being sent", async () => {
    signedIn.value = true;
    render(<PwaPrompts />);
    await userEvent.click(screen.getByRole("button", { name: "update" }));
    expect(hasRecordsToSend).toHaveBeenCalledWith("ann");
  });
});
