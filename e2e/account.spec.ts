import { MEMBER_STATE } from "./accounts";
import { expect, test } from "./fixtures";

/*
 * A member renames themselves. Reloading is the point: the name has to come
 * back from the server, not from what the form was still holding.
 */
test.describe("renaming", () => {
  let original = "";

  test.afterEach(async ({ playwright, baseURL }) => {
    // Through the API, so a failed assertion cannot leave the renamed member
    // behind for the specs that follow.
    if (original === "") return;
    const api = await playwright.request.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      storageState: MEMBER_STATE,
    });
    await api.patch("/api/users/me", { data: { name: original } });
    await api.dispose();
  });

  test("a new name is still there after a reload", async ({ memberPage }) => {
    await memberPage.goto("/account");
    const input = memberPage.getByLabel("Your name");
    await expect(input).not.toHaveValue("");
    original = await input.inputValue();

    await input.fill("Alice E2E");
    await memberPage.getByRole("button", { name: "Save name" }).click();
    await expect(memberPage.getByRole("status")).toHaveText("Name saved.");

    await memberPage.reload();
    await expect(memberPage.getByLabel("Your name")).toHaveValue("Alice E2E");
  });
});

test.describe("signing out", () => {
  test("Back does not return to the signed-in app", async ({ memberPage, baseURL }) => {
    await memberPage.goto("/account");
    await memberPage.getByRole("button", { name: "Sign out" }).click();
    await expect(memberPage).toHaveURL(/sign-in/);
    // A relative redirect: the origin the member was on is the one they stay on.
    expect(new URL(memberPage.url()).origin).toBe(baseURL);
    await expect(memberPage.getByRole("navigation", { name: "Primary" })).toBeHidden();

    await memberPage.goBack();
    await expect(memberPage).toHaveURL(/sign-in/);
    await expect(memberPage.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await expect(memberPage.getByLabel("Your name")).toBeHidden();
  });
});
