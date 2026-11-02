import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordOnBehalfForm } from "@/components/visits/record-on-behalf-form";
import type { Block, User } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { ApiRequestError } from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

vi.mock("@/lib/uuid", () => ({ uuidv7: () => "01960000-0000-7000-8000-000000000001" }));

const AT = "2026-01-01T00:00:00.000Z";

const members: User[] = [
  {
    id: "u1",
    email: "alice@t.local",
    name: "Alice",
    image: null,
    role: "member",
    deactivatedAt: null,
    lastRecordedAt: null,
    createdAt: AT,
  },
  {
    id: "u2",
    email: "nameless@t.local",
    name: null,
    image: null,
    role: "member",
    deactivatedAt: null,
    lastRecordedAt: null,
    createdAt: AT,
  },
];

const blocks: Block[] = [
  { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
  { id: "b2", name: "125", street: "Test Ave", postalCode: null, createdAt: AT },
];

function renderForm(
  overrides: { onRecorded?: (visit: unknown, unit: string) => void; onClose?: () => void } = {},
) {
  const user = userEvent.setup();
  render(
    <RecordOnBehalfForm
      members={members}
      blocks={blocks}
      onRecorded={overrides.onRecorded ?? vi.fn()}
      onClose={overrides.onClose ?? vi.fn()}
    />,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RecordOnBehalfForm", () => {
  it("attributes the record to the member who knocked, not to the admin", async () => {
    const user = renderForm();
    apiFetch.mockResolvedValue({});

    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/visits", expect.anything());
    });
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      memberId: "u1",
      blockId: "b1",
      unitNumber: "#05-123",
      interestLevel: "high",
    });
  });

  it("normalises the unit the same way the field form does", async () => {
    // Otherwise "#5-9" and "#05-9" become two households at one door.
    const onRecorded = vi.fn();
    const user = renderForm({ onRecorded });
    const answer = { id: "v1", followUpsMarkedDone: ["n1"] };
    apiFetch.mockResolvedValue(answer);

    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.type(screen.getByLabelText("Unit number"), "  #05-0123  ");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ unitNumber: "#05-0123" });
    // The server's answer goes back with the unit as sent, for the records
    // screen to say what the record marked done.
    expect(onRecorded).toHaveBeenCalledWith(answer, "#05-0123");
  });

  it("falls back to the email for a member with no name", () => {
    renderForm();
    expect(screen.getByRole("option", { name: "nameless@t.local" })).toBeInTheDocument();
  });

  it("refuses to guess who recorded it", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a member");
    // Nothing typed was blank: the line alone says what is missing (#119).
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses a record with no unit", async () => {
    const user = renderForm();
    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses a record on an outing with no blocks rather than send it nowhere", async () => {
    const user = userEvent.setup();
    render(
      <RecordOnBehalfForm members={members} blocks={[]} onRecorded={vi.fn()} onClose={vi.fn()} />,
    );
    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/a block/);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses a record with no interest level", async () => {
    const user = renderForm();
    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  describe("the Not saved pop-up (#119)", () => {
    const notSaved = () => within(screen.getByRole("alertdialog", { name: "Not saved" }));
    const reasons = () =>
      notSaved()
        .getAllByRole("listitem")
        .map((item) => item.textContent);

    it("lists everything missing when the unit is blank, and OK goes to the first", async () => {
      const user = renderForm();
      await user.type(screen.getByLabelText("Unit number"), "  ");
      await user.click(screen.getByRole("button", { name: "Save the record" }));

      expect(notSaved().getByText("This visit could not be saved because:")).toBeInTheDocument();
      expect(reasons()).toEqual([
        "No member is chosen.",
        "The unit number is blank.",
        "No interest level is chosen.",
      ]);
      await user.click(notSaved().getByRole("button", { name: "OK" }));

      expect(screen.getByLabelText("Recorded by")).toHaveFocus();
      // The sheet is still open and still says why, above the form.
      expect(screen.getByRole("dialog", { name: "Record on behalf of a member" })).toBeVisible();
      expect(screen.getByRole("alert")).toHaveTextContent("Choose a member");
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("goes back to the unit when that is all that is wrong", async () => {
      const user = renderForm();
      await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
      await user.click(screen.getByRole("radio", { name: "Low" }));
      await user.click(screen.getByRole("button", { name: "Save the record" }));

      expect(reasons()).toEqual(["The unit number is blank."]);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByLabelText("Unit number")).toHaveFocus();
      // Escape answered the pop-up, not the sheet.
      expect(screen.getByRole("dialog", { name: "Record on behalf of a member" })).toBeVisible();
    });

    it("names the block, and the first interest level, when an outing has no blocks", async () => {
      const user = userEvent.setup();
      render(
        <RecordOnBehalfForm members={members} blocks={[]} onRecorded={vi.fn()} onClose={vi.fn()} />,
      );
      await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
      await user.click(screen.getByRole("button", { name: "Save the record" }));

      expect(reasons()).toEqual([
        "No block is chosen.",
        "The unit number is blank.",
        "No interest level is chosen.",
      ]);
      await user.click(notSaved().getByRole("button", { name: "OK" }));
      expect(screen.getByLabelText("Block")).toHaveFocus();
    });

    it("opens for the server's refusal, and keeps what was typed", async () => {
      apiFetch.mockRejectedValue(
        new ApiRequestError(400, {
          error: {
            code: "validation_failed",
            message: "Invalid request body.",
            details: [{ path: "/interestLevel", message: "Invalid option" }],
          },
        }),
      );
      const user = renderForm();
      await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
      await user.type(screen.getByLabelText("Unit number"), "#05-123");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save the record" }));

      expect(await screen.findByRole("alertdialog", { name: "Not saved" })).toBeInTheDocument();
      expect(reasons()).toEqual(["No interest level is chosen."]);
      await user.click(notSaved().getByRole("button", { name: "OK" }));
      expect(screen.getByRole("radio", { name: "No response" })).toHaveFocus();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Not saved. No interest level is chosen.",
      );
      expect(screen.getByLabelText("Unit number")).toHaveValue("#05-123");
    });

    it("gives focus back to Save when the server named nothing on the form", async () => {
      apiFetch.mockRejectedValue(
        new ApiRequestError(400, {
          error: {
            code: "validation_failed",
            message: "Invalid request body.",
            details: [{ path: "/description", message: "Too big" }],
          },
        }),
      );
      const user = renderForm();
      await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
      await user.type(screen.getByLabelText("Unit number"), "#05-123");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save the record" }));

      expect(await screen.findByRole("alertdialog", { name: "Not saved" })).toBeInTheDocument();
      expect(reasons()).toEqual(["Too big"]);
      await user.click(notSaved().getByRole("button", { name: "OK" }));
      expect(screen.getByRole("button", { name: "Save the record" })).toHaveFocus();
    });
  });

  it("reports the server's refusal without losing what was typed", async () => {
    const user = renderForm();
    apiFetch.mockRejectedValue(new Error("That block is not part of the active session."));

    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not part of the active session");
    expect(screen.getByLabelText("Unit number")).toHaveValue("#05-123");
  });

  it("copes with a non-Error failure", async () => {
    const user = renderForm();
    apiFetch.mockRejectedValue("boom");

    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not record that visit.");
  });

  it("lets the block be changed", async () => {
    const user = renderForm();
    apiFetch.mockResolvedValue({});

    await user.selectOptions(screen.getByLabelText("Recorded by"), "u1");
    await user.selectOptions(screen.getByLabelText("Block"), "b2");
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.type(screen.getByLabelText("Notes"), "Left a pamphlet");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save the record" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      blockId: "b2",
      description: "Left a pamphlet",
    });
  });

  it("closes from the backdrop and from Cancel", async () => {
    const onClose = vi.fn();
    const user = renderForm({ onClose });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("asks before a stray tap on the backdrop loses a record typed in", async () => {
    const onClose = vi.fn();
    const user = renderForm({ onClose });
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("button", { name: "Close" }));

    const ask = screen.getByRole("alertdialog", { name: "Discard this visit?" });
    expect(ask).toHaveTextContent("What you typed has not been saved.");
    await user.click(within(ask).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is a modal: focus moves in and Escape closes", async () => {
    const onClose = vi.fn();
    const user = renderForm({ onClose });
    expect(screen.getByRole("dialog", { name: "Record on behalf of a member" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
