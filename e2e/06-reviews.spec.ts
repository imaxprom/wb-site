import { test } from "@playwright/test";
import { login, snap, clickAndSnap, waitForStable, clickIfExists } from "./helpers";

test.describe("Reviews Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/reviews");
    await waitForStable(page);
  });

  test("main view with table", async ({ page }) => {
    await snap(page, "reviews-main");
  });

  // Tab navigation
  test("navigate to accounts tab", async ({ page }) => {
    await clickAndSnap(
      page,
      'a:has-text("Аккаунты"), button:has-text("Аккаунты")',
      "reviews-accounts-tab"
    );
  });

  // Filters
  test("filters panel renders", async ({ page }) => {
    // Try to expand filters if collapsed
    await clickIfExists(page, 'button:has-text("Фильтр"), [class*="filter"]');
    await page.waitForTimeout(500);
    await snap(page, "reviews-filters-panel");
  });

  // Table sorting
  test("table column sort", async ({ page }) => {
    const th = page.locator("th").first();
    if (await th.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await th.click();
      await page.waitForTimeout(500);
      await snap(page, "reviews-table-sorted");
    }
  });
});

test.describe("Reviews Accounts Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/reviews/accounts");
    await waitForStable(page);
  });

  test("accounts list view", async ({ page }) => {
    await snap(page, "reviews-accounts-main");
  });

  // Period selector for charts
  test("chart period selector", async ({ page }) => {
    const periods = ["week", "month", "year"];
    for (const period of periods) {
      const btn = page.locator(`button:has-text("${period}"), [data-period="${period}"]`).first();
      if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);
        await snap(page, `reviews-accounts-chart-${period}`);
      }
    }
  });
});
