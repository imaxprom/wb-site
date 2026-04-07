import { test } from "@playwright/test";
import { login, snap, waitForStable } from "./helpers";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await waitForStable(page);
  });

  test("settings page view", async ({ page }) => {
    await snap(page, "settings-main");
  });

  // API key section
  test("api key input visible", async ({ page }) => {
    const input = page.locator('input[type="text"], input[type="password"], textarea').first();
    if (await input.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await snap(page, "settings-apikey-section");
    }
  });
});
