import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PressFeedback } from "@/components/ui/press-feedback";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PressFeedback", () => {
  it("listens for touchstart, passively, so iOS shows press states", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<PressFeedback />);

    const call = add.mock.calls.find(([type]) => type === "touchstart");
    expect(call?.[2]).toEqual({ passive: true });

    unmount();
    expect(remove).toHaveBeenCalledWith("touchstart", call?.[1]);
  });
});
