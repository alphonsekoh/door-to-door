import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSessionForm } from "@/components/sessions/create-session-form";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

async function open() {
  const user = userEvent.setup();
  render(<CreateSessionForm onCreated={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "New session" }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateSessionForm", () => {
  it("stays out of the way until asked for", () => {
    render(<CreateSessionForm onCreated={vi.fn()} />);
    expect(screen.queryByLabelText("Name this session")).not.toBeInTheDocument();
  });

  it("creates a draft, not a running outing", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    apiFetch.mockResolvedValue({ id: "s1", status: "draft" });
    render(<CreateSessionForm onCreated={onCreated} />);

    await user.click(screen.getByRole("button", { name: "New session" }));
    await user.type(screen.getByLabelText("Name this session"), "Saturday morning");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Saturday morning" }),
    });
  });

  it("refuses an outing with no name, before a round trip", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Give the session a name.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("treats whitespace as no name", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Name this session"), "   ");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the server refuses", async () => {
    const user = await open();
    apiFetch.mockRejectedValue(new Error("A session with that name already exists."));

    await user.type(screen.getByLabelText("Name this session"), "Saturday morning");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByLabelText("Name this session")).toHaveValue("Saturday morning");
  });

  it("copes with a non-Error failure", async () => {
    const user = await open();
    apiFetch.mockRejectedValue("boom");

    await user.type(screen.getByLabelText("Name this session"), "Saturday");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the session.");
  });

  it("folds away again on cancel", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
  });
});
