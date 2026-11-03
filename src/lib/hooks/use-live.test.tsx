import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useLive } from "@/lib/hooks/use-live";

function Probe() {
  return <p>{useLive() ? "live" : "not live"}</p>;
}

describe("useLive", () => {
  it("is false in the server's HTML", () => {
    expect(renderToString(<Probe />)).toContain("not live");
  });

  it("hydrates as the server drew it, then is true", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.append(container);
    const mismatch = vi.fn();
    const root = await act(() =>
      hydrateRoot(container, <Probe />, { onRecoverableError: mismatch }),
    );

    expect(mismatch).not.toHaveBeenCalled();
    expect(container).toHaveTextContent("live");
    expect(container).not.toHaveTextContent("not live");
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("is true from the first render of a page already live", () => {
    const { unmount } = render(<Probe />);
    expect(screen.getByText("live")).toBeInTheDocument();
    unmount();
  });
});
