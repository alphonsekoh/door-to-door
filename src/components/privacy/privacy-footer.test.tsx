import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivacyFooter } from "@/components/privacy/privacy-footer";

describe("PrivacyFooter", () => {
  it("links the privacy policy", () => {
    render(<PrivacyFooter />);
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
