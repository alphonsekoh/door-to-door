import { describe, expect, it, vi } from "vitest";
import { signInWithPassword } from "@/lib/session/password-sign-in";

/* What next-auth/react's signIn hands back with redirect: false. */
const signedIn = { error: undefined };
const refusedFor = (error: string) => ({ error });
const csrfRefused = refusedFor("MissingCSRF");

function signInAnswering(...answers: { error: string | undefined }[]) {
  const signIn =
    vi.fn<
      (
        provider: "credentials",
        options: { email: string; password: string; redirect: false },
      ) => Promise<{ error: string | undefined }>
    >();
  for (const answer of answers) signIn.mockResolvedValueOnce(answer);
  return signIn;
}

describe("signInWithPassword", () => {
  it("signs in with one attempt when nothing is refused", async () => {
    const signIn = signInAnswering(signedIn);

    await expect(signInWithPassword(signIn, "ann@example.com", "password123")).resolves.toBe(
      "signed-in",
    );
    expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", {
      email: "ann@example.com",
      password: "password123",
      redirect: false,
    });
  });

  /* Auth.js's type for what the credentials check refuses, and the one it
     answers with when anything else went wrong on the server. */
  it.each(["CredentialsSignin", "Configuration"])(
    "gives up after one attempt when it is refused as %s, never trying the password again",
    async (error) => {
      const signIn = signInAnswering(refusedFor(error));

      await expect(signInWithPassword(signIn, "ann@example.com", "wrong")).resolves.toBe("refused");
      expect(signIn).toHaveBeenCalledOnce();
    },
  );

  it("sends a CSRF refusal again, silently, and signs in on the second go", async () => {
    const signIn = signInAnswering(csrfRefused, signedIn);

    await expect(signInWithPassword(signIn, "ann@example.com", "password123")).resolves.toBe(
      "signed-in",
    );
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(signIn.mock.calls[1]).toEqual(signIn.mock.calls[0]);
  });

  it("keeps a refusal about the account generic when the retry reaches the credentials", async () => {
    const signIn = signInAnswering(csrfRefused, refusedFor("CredentialsSignin"));

    await expect(signInWithPassword(signIn, "ann@example.com", "wrong")).resolves.toBe("refused");
  });

  it("says the page expired when the retry is refused for CSRF too, and stops there", async () => {
    const signIn = signInAnswering(csrfRefused, csrfRefused, signedIn);

    await expect(signInWithPassword(signIn, "ann@example.com", "password123")).resolves.toBe(
      "expired",
    );
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});
