import { test } from "@playwright/test";
import { login, snap, waitForStable, clickIfExists } from "./helpers";

test.describe("Monitor Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/monitor");
    await waitForStable(page);
  });

  test("main dashboard view", async ({ page }) => {
    await snap(page, "monitor-main");
  });

  // Try to open logs modal for first service
  test("open logs modal", async ({ page }) => {
    const logBtn = page.locator('button:has-text("Логи"), button:has-text("logs"), button:has(svg)').first();
    if (await logBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await logBtn.click();
      await page.waitForTimeout(1000);
      await snap(page, "monitor-logs-modal");

      // Test line count buttons
      const btn50 = page.locator('button:has-text("50")').first();
      if (await btn50.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await btn50.click();
        await page.waitForTimeout(500);
        await snap(page, "monitor-logs-50");
      }

      // Close modal
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  });

  // Service action buttons
  test("service cards render", async ({ page }) => {
    const serviceCards = page.locator('[class*="service"], [class*="card"]');
    const count = await serviceCards.count();
    if (count > 0) {
      await snap(page, "monitor-service-cards");
    }
  });
});
