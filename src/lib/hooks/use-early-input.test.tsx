import { act, render, screen } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useEarlyInput } from "@/lib/hooks/use-early-input";

/* A controlled field with nothing else to keep it: the next render after
   hydrating puts the state back into it. */
function Field({ initial = "", onEntered }: { initial?: string; onEntered?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  const field = useRef<HTMLInputElement>(null);
  const read = useCallback(() => field.current?.value, []);
  const enter = useCallback(
    (entered: string) => {
      onEntered?.(entered);
      setValue(entered);
    },
    [onEntered],
  );
  useEarlyInput(read, value, enter);
  return (
    <>
      <input
        ref={field}
        aria-label="Unit"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <p>Held: {value}</p>
    </>
  );
}

async function hydrate(ui: React.ReactElement, typed: string) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(ui);
  document.body.append(container);
  const field = container.querySelector("input");
  if (field === null) throw new Error("no field in the server's HTML");
  // What the member typed with no script on the page yet.
  field.value = typed;
  const root = await act(() => hydrateRoot(container, ui));
  return {
    container,
    field,
    rerender: (next: React.ReactElement) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useEarlyInput", () => {
  it("hands on what was typed into the server's HTML, so the next render keeps it", async () => {
    const entered = vi.fn();
    const page = await hydrate(<Field initial="#05-123" onEntered={entered} />, "#09-999");

    expect(entered).toHaveBeenCalledExactlyOnceWith("#09-999");
    page.rerender(<Field initial="#05-123" onEntered={entered} />);
    expect(page.field).toHaveValue("#09-999");
    expect(page.container).toHaveTextContent("Held: #09-999");
    page.unmount();
  });

  it("hands on nothing when the field still holds what the server drew", async () => {
    const entered = vi.fn();
    const page = await hydrate(<Field initial="#05-123" onEntered={entered} />, "#05-123");

    expect(entered).not.toHaveBeenCalled();
    page.unmount();
  });

  it("looks only as it mounts: what is typed later is the state's own", async () => {
    const entered = vi.fn();
    const page = await hydrate(<Field onEntered={entered} />, "");

    page.field.value = "#01-001";
    page.rerender(<Field onEntered={vi.fn()} />);
    expect(entered).not.toHaveBeenCalled();
    expect(page.field).toHaveValue("");
    page.unmount();
  });

  it("does nothing on a page React drew itself", () => {
    const entered = vi.fn();
    render(<Field initial="#05-123" onEntered={entered} />);
    expect(entered).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Unit")).toHaveValue("#05-123");
  });

  it("does nothing where there is no field to read", () => {
    const entered = vi.fn();
    function Nothing() {
      const read = useCallback(() => undefined, []);
      useEarlyInput(read, "", entered);
      return null;
    }
    render(<Nothing />);
    expect(entered).not.toHaveBeenCalled();
  });
});
