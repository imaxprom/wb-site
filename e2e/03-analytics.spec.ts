import { test } from "@playwright/test";
import { login, snap, clickIfExists, waitForStable } from "./helpers";

test.describe("Analytics Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/analytics");
    await waitForStable(page);
  });

  test("main view with stats and charts", async ({ page }) => {
    await snap(page, "analytics-main");
  });

  test("date range picker opens and closes", async ({ page }) => {
    // Try clicking the date picker trigger
    const dateBtn = page.locator('[class*="date"], button:has-text("—"), button:has(svg)').first();
    if (await dateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dateBtn.click();
      await page.waitForTimeout(500);
      await snap(page, "analytics-datepicker-open");

      // Close it
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  });

  test("stat cards render", async ({ page }) => {
    // Screenshot the stats area
    await snap(page, "analytics-stats");
  });
});
