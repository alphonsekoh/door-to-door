import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddMemberForm } from "@/components/admin/add-member-form";
import { ApiRequestError } from "@/lib/api-client";
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

/* As config.yaml's auth.google.domains has them; t.local stands for a listed one. */
const DOMAINS = ["gmail.com", "t.local"];

const refusal = (message: string) =>
  new ApiRequestError(409, { error: { code: "conflict", message } });

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
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("adds someone with an initial password", async () => {
    const onAdded = vi.fn();
    apiFetch.mockResolvedValue(created);
    render(<AddMemberForm onAdded={onAdded} googleDomains={DOMAINS} />);
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
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
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
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("status")).toHaveTextContent("password123");
    expect(screen.getByRole("status")).toHaveTextContent("new@t.local");
  });

  it("does not mask the password from the admin setting it", async () => {
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    await open();
    expect(screen.getByLabelText("Initial password")).toHaveAttribute("type", "text");
  });

  it("refuses an empty email before a round trip", async () => {
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    const user = await open();

    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an email address.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses a password shorter than the contract allows", async () => {
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "short");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the server refuses the email", async () => {
    apiFetch.mockRejectedValue(refusal("That email address already belongs to someone."));
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "alice@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already belongs to someone");
    expect(screen.getByLabelText("Email")).toHaveValue("alice@t.local");
  });

  /* #194: not the browser's "Failed to fetch". */
  it("says its own sentence when the request gets no answer", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/^Could not add that person\.$/);
    expect(screen.getByLabelText("Email")).toHaveValue("new@t.local");
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    const user = await open();

    await user.type(screen.getByLabelText("Email"), "new@t.local");
    await user.type(screen.getByLabelText("Initial password"), "password123");
    await user.click(screen.getByRole("button", { name: "Add to the team" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add that person.");
  });

  it("folds away again on cancel", async () => {
    render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add someone" })).toBeInTheDocument();
  });

  describe("with no password (#14)", () => {
    it("says how to add someone who signs in with Google only, and where that works", async () => {
      render(
        <AddMemberForm onAdded={vi.fn()} googleDomains={["gmail.com", "tjc.sg", "tjc.org"]} />,
      );
      await open();
      expect(screen.getByLabelText("Initial password")).toHaveAccessibleDescription(
        "Leave empty to sign in with Google only. That works for addresses at gmail.com, tjc.sg or tjc.org.",
      );
    });

    it("offers no such thing while Google sign-in is not set up, and asks for a password", async () => {
      render(<AddMemberForm onAdded={vi.fn()} googleDomains={null} />);
      const user = await open();
      expect(screen.getByLabelText("Initial password")).not.toHaveAccessibleDescription();
      expect(screen.queryByText(/Google/)).not.toBeInTheDocument();

      await user.type(screen.getByLabelText("Email"), "new@t.local");
      await user.click(screen.getByRole("button", { name: "Add to the team" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Enter an initial password.");
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("refuses an address Google would not sign in, naming where it works, before a round trip", async () => {
      render(<AddMemberForm onAdded={vi.fn()} googleDomains={["gmail.com", "tjc.sg"]} />);
      const user = await open();
      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.click(screen.getByRole("button", { name: "Add to the team" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Google sign-in works only for addresses at gmail.com or tjc.sg, so they need a password.",
      );
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("adds them without sending a password, and says they sign in with Google", async () => {
      apiFetch.mockResolvedValue(created);
      const onAdded = vi.fn();
      render(<AddMemberForm onAdded={onAdded} googleDomains={DOMAINS} />);
      const user = await open();

      await user.type(screen.getByLabelText("Email"), "new@t.local");
      await user.click(screen.getByRole("button", { name: "Add to the team" }));

      await waitFor(() => {
        expect(onAdded).toHaveBeenCalledWith(created);
      });
      // No password key at all: the contract's minimum would refuse an empty one.
      expect(apiFetch).toHaveBeenCalledWith("/users", {
        method: "POST",
        body: JSON.stringify({ email: "new@t.local", name: null, role: "member" }),
      });
      expect(await screen.findByRole("status")).toHaveTextContent(
        "new@t.local can sign in with Google.",
      );
    });

    it("shows the server's refusal, which is what holds", async () => {
      // Set up when the page was drawn, and since taken out of config.yaml.
      apiFetch.mockRejectedValue(
        new ApiRequestError(400, {
          error: {
            code: "validation_failed",
            message: "Google sign-in isn't set up here, so they need a password.",
          },
        }),
      );
      render(<AddMemberForm onAdded={vi.fn()} googleDomains={DOMAINS} />);
      const user = await open();
      await user.type(screen.getByLabelText("Email"), "new@t.local");
      await user.click(screen.getByRole("button", { name: "Add to the team" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("they need a password");
    });
  });
});
