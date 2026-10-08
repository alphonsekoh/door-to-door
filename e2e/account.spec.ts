import { expect, test } from "./fixtures";

/*
 * A member renames themselves. Reloading is the point: the name has to come
 * back from the server, not from what the form was still holding.
 */
test("a new name is still there after a reload", async ({ memberPage }) => {
  await memberPage.goto("/account");
  const input = memberPage.getByLabel("Your name");
  await expect(input).not.toHaveValue("");
  const original = await input.inputValue();

  await input.fill("Alice E2E");
  await memberPage.getByRole("button", { name: "Save name" }).click();
  await expect(memberPage.getByRole("status")).toHaveText("Name saved.");

  await memberPage.reload();
  await expect(memberPage.getByLabel("Your name")).toHaveValue("Alice E2E");

  // Leave the seeded name as it was for whatever runs next.
  await memberPage.getByLabel("Your name").fill(original);
  await memberPage.getByRole("button", { name: "Save name" }).click();
  await expect(memberPage.getByRole("status")).toHaveText("Name saved.");
});
