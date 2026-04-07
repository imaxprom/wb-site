import { test } from "@playwright/test";
import { login, snap, waitForStable } from "./helpers";

test.describe("Debug Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/debug");
    await waitForStable(page);
  });

  test("debug page main view", async ({ page }) => {
    await snap(page, "debug-main");
  });

  // Click each data fetch button
  const buttons = [
    { text: "Сводка остатков", name: "stocks-summary" },
    { text: "Сырые данные", name: "stocks-raw" },
    { text: "Заказы", name: "orders-stats" },
  ];

  for (const btn of buttons) {
    test(`fetch: ${btn.name}`, async ({ page }) => {
      const button = page.locator(`button:has-text("${btn.text}")`).first();
      if (await button.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await button.click();
        // Wait for response to load
        await page.waitForTimeout(3000);
        await snap(page, `debug-${btn.name}`);
      }
    });
  }
});
