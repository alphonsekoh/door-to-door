import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/confirm-dialog";

const props = {
  title: "End outing",
  detail: "Members will not be able to record until it is reopened.",
  confirmLabel: "End outing",
  busy: false,
};

describe("ConfirmDialog", () => {
  it("states what will happen, not just that something will", () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alertdialog", { name: "End outing" })).toBeInTheDocument();
    expect(screen.getByText(props.detail)).toBeInTheDocument();
  });

  it("confirms only when the confirming button is pressed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "End outing" }));
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
});
