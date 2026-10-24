import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTargetSession } from "@/lib/hooks/use-target-session";

const { loadTarget } = vi.hoisted(() => ({ loadTarget: vi.fn() }));
vi.mock("@/lib/follow-ups/target-session", () => ({ loadTarget }));

function Probe({ enabled }: { enabled: boolean }) {
  const state = useTargetSession(enabled);
  return (
    <p>{state.status === "ready" ? `ready: ${state.target?.title ?? "none"}` : state.status}</p>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTargetSession", () => {
  it("asks which follow-up session, and gives it", async () => {
    loadTarget.mockResolvedValue({ title: "Saturday revisits" });
    render(<Probe enabled />);
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("ready: Saturday revisits")).toBeInTheDocument();
  });

  it("says when it could not tell", async () => {
    loadTarget.mockRejectedValue(new TypeError("offline"));
    render(<Probe enabled />);
    expect(await screen.findByText("error")).toBeInTheDocument();
  });

  it("asks nothing when off, and is simply none", () => {
    render(<Probe enabled={false} />);
    expect(screen.getByText("ready: none")).toBeInTheDocument();
    expect(loadTarget).not.toHaveBeenCalled();
  });

  it("asks once it is turned on", async () => {
    loadTarget.mockResolvedValue(null);
    const { rerender } = render(<Probe enabled={false} />);
    rerender(<Probe enabled />);
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("ready: none")).toBeInTheDocument();
  });
});
