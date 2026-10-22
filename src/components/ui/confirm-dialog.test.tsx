import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/sheet";

const props = {
  title: "End session",
  detail: "Members will not be able to record until it is reopened.",
  confirmLabel: "End session",
  busy: false,
};

describe("ConfirmDialog", () => {
  it("states what will happen, not just that something will", () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alertdialog", { name: "End session" })).toBeInTheDocument();
    expect(screen.getByText(props.detail)).toBeInTheDocument();
  });

  it("confirms only when the confirming button is pressed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "End session" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("backs out from the keep button and from the backdrop", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Keep as it is" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("cannot be double-submitted while it works", () => {
    render(<ConfirmDialog {...props} busy onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });

  it("opens on the way out, not on the button that takes something away", () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Keep as it is" })).toHaveFocus();
  });

  it("backs out on Escape and keeps Tab inside", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "End session" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Keep as it is" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("looks destructive by default, so it never passes for Save", () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "End session" })).toHaveClass("btn-danger");
  });

  it("can ask in the ordinary tone when nothing is taken away", () => {
    render(<ConfirmDialog {...props} tone="default" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const confirm = screen.getByRole("button", { name: "End session" });
    expect(confirm).toHaveClass("btn-primary");
    expect(confirm).not.toHaveClass("btn-danger");
  });
});
