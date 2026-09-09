import { test, expect } from "@playwright/test";
import { loginViaUI, readCreds } from "./helpers/auth";

test("login smoke — throwaway user reaches post-login shell", async ({ page }) => {
  await loginViaUI(page, readCreds());
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator("body")).toBeVisible();
});
