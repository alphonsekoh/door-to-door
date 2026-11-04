import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InterestPicker } from "@/components/ui/interest-picker";
import type { InterestLevel } from "@/generated/types.gen";

function Picker({ onChange }: { onChange?: (level: InterestLevel) => void }) {
  const [value, setValue] = useState<InterestLevel | null>(null);
  return (
    <InterestPicker
      value={value}
      onChange={(level) => {
        onChange?.(level);
        setValue(level);
      }}
    />
  );
}

describe("InterestPicker", () => {
  it("is one group of four radios, one chosen at a time", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const group = screen.getByRole("radiogroup", { name: "Interest level" });
    expect(within(group).getAllByRole("radio")).toHaveLength(4);

    await user.click(screen.getByRole("radio", { name: "High" }));
    expect(screen.getByRole("radio", { name: "High" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "No response" }));
    expect(screen.getByRole("radio", { name: "No response" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "High" })).not.toBeChecked();
  });

  /* A page loaded again from history gets back what its form held, and a
     level ticked that way is adopted as picked, with the unit it went with
     gone (the unit field is off too). jsdom restores nothing; the browsers
     honour this attribute. */
  it("leaves no level for the browser to restore from history", () => {
    render(<Picker />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("autocomplete", "off");
    }
  });

  it("keeps a sheet's picker apart from the form's under it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <section aria-label="Form">
          <Picker />
        </section>
        <section aria-label="Sheet">
          <Picker />
        </section>
      </>,
    );
    const form = within(screen.getByRole("region", { name: "Form" }));
    const sheet = within(screen.getByRole("region", { name: "Sheet" }));
    await user.click(form.getByRole("radio", { name: "Low" }));
    await user.click(sheet.getByRole("radio", { name: "High" }));

    expect(form.getByRole("radio", { name: "Low" })).toBeChecked();
    expect(sheet.getByRole("radio", { name: "High" })).toBeChecked();
  });

  /* A slow connection draws the form before its script: the browser checks
     a radio tapped then, and the page must not uncheck it as it goes live. */
  it("keeps a level picked in the server's HTML before the page was live", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Picker />);
    document.body.append(container);
    within(container).getByRole("radio", { name: "Medium" }).click();

    const picked = vi.fn();
    const mismatch = vi.fn();
    const root = await act(() =>
      hydrateRoot(container, <Picker onChange={picked} />, { onRecoverableError: mismatch }),
    );

    expect(mismatch).not.toHaveBeenCalled();
    expect(picked).toHaveBeenCalledExactlyOnceWith("medium");
    expect(within(container).getByRole("radio", { name: "Medium" })).toBeChecked();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("hands on nothing when nothing was picked before the page was live", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Picker />);
    document.body.append(container);

    const picked = vi.fn();
    const root = await act(() => hydrateRoot(container, <Picker onChange={picked} />));

    expect(picked).not.toHaveBeenCalled();
    expect(within(container).queryByRole("radio", { checked: true })).toBeNull();
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
