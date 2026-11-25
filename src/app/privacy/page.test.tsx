import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import { POLICY_SECTIONS } from "@/lib/privacy/policy";

const { connection, privacyContact } = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
  privacyContact: vi.fn(() => ({
    organisation: "Example Operator",
    dpoEmail: "dpo@example.com",
  })),
}));
vi.mock("next/server", () => ({ connection }));
vi.mock("@/server/privacy/contact", () => ({ privacyContact }));
vi.mock("next/navigation", () => ({ usePathname: () => "/privacy" }));

describe("privacy page", () => {
  it("renders the title, the date and every section in order", async () => {
    render(await PrivacyPage());
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeInTheDocument();
    expect(screen.getByText("Last updated 25 Nov 2026")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(
      POLICY_SECTIONS.map(({ heading }) => heading),
    );
  });

  it("names the configured operator and links the DPO's email", async () => {
    render(await PrivacyPage());
    expect(screen.getAllByText(/Example Operator/).length).toBeGreaterThan(0);
    const mail = screen.getByRole("link", { name: "dpo@example.com" });
    expect(mail).toHaveAttribute("href", "mailto:dpo@example.com");
  });

  it("names messaging among its purposes, and signing out as keeping unsent records", async () => {
    render(await PrivacyPage());
    const purposes = screen.getByRole("region", { name: "Why we record it" });
    expect(purposes.textContent).toContain("call or text you");
    expect(purposes.textContent).not.toContain("do not use it for marketing");
    expect(document.body.textContent).toContain(
      "Records not yet sent stay until they are sent, for 30 days at most.",
    );
  });

  it("offers a way back, and reads per request", async () => {
    render(await PrivacyPage());
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
    expect(connection).toHaveBeenCalled();
  });

  it("promises no consent record, and says the team asks before it calls", async () => {
    const { container } = render(await PrivacyPage());
    expect(container.textContent).toContain("The app itself never calls or messages anyone.");
    expect(container.textContent).toContain(
      "only after asking the person and getting their agreement",
    );
    expect(container.textContent).toContain("The app does not record that agreement.");
    expect(container.textContent).toContain(
      "If you withdraw it, we mark your contact so the team does not call or message it.",
    );
    expect(container.textContent).not.toMatch(/organisation/i);
  });
});
