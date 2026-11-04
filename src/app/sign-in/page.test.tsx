import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SignInPage from "@/app/sign-in/page";

vi.mock("next-auth/react", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

describe("sign-in page", () => {
  it("renders the heading and the form", () => {
    render(<SignInPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("says where an account comes from, since there is no self-registration", () => {
    render(<SignInPage />);
    expect(screen.getByText(/admin set up for you/i)).toBeInTheDocument();
  });
});
