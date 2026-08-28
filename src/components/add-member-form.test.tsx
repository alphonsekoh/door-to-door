import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddMemberForm } from "@/components/add-member-form";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const created = {
  id: "u9",
  email: "new@t.local",
  name: "New Person",
  image: null,
  role: "member" as const,
  deactivatedAt: null,
  lastRecordedAt: null,
  createdAt: "2026-03-14T11:00:00.000Z",
};

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add someone" }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddMemberForm", () => {
  it("stays out of the way until asked for", () => {
    render(<AddMemberForm onAdded={vi.fn()} />);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("adds someone with an initial password", async () => {
    const onAdded = vi.fn();
    apiFetch.mockResolvedValue(created);
    render(<AddMemberForm onAdded={onAdded} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/users", {
      method: "POST",
      body: JSON.stringify({
        email: "new@t.local",
        name: "New Person",
        password: "password123",
        role: "member",
      }),
    });
  });

  it("can add an admin", async () => {
    apiFetch.mockResolvedValue({ ...created, role: "admin" });
    render(<AddMemberForm onAdded={vi.fn()} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "boss@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.selectOptions(screen.getByLabelText("Role"), "admin");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ role: "admin", name: null });
  });

  it("keeps the password on screen so it can be passed on", async () => {
    // There is no invite email; somebody has to read it out.
    apiFetch.mockResolvedValue(created);
    render(<AddMemberForm onAdded={vi.fn()} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("status")).toHaveTextContent("password123");
    expect(screen.getByRole("status")).toHaveTextContent("new@t.local");
  });

  it("does not mask the password from the admin setting it", async () => {
    render(<AddMemberForm onAdded={vi.fn()} />);
    await open();
    expect(screen.getByLabelText("Initial password")).toHaveAttribute("type", "text");
  });

  it("refuses an empty email before a round trip", async () => {
    render(<AddMemberForm onAdded={vi.fn()} />);
    const user = await open();

    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an email address.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses a password shorter than the contract allows", async () => {
    render(<AddMemberForm onAdded={vi.fn()} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "short");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the server refuses the email", async () => {
    apiFetch.mockRejectedValue(new Error("That email address already belongs to someone."));
    render(<AddMemberForm onAdded={vi.fn()} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "alice@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already belongs to someone");
    expect(screen.getByLabelText("Email")).toHaveValue("alice@t.local");
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AddMemberForm onAdded={vi.fn()} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add that person.");
  });

  it("folds away again on cancel", async () => {
    render(<AddMemberForm onAdded={vi.fn()} />);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add someone" })).toBeInTheDocument();
  });
});
