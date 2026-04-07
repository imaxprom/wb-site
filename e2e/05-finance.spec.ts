import { test } from "@playwright/test";
import { login, snap, clickAndSnap, waitForStable } from "./helpers";

test.describe("Finance Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/finance");
    await waitForStable(page);
  });

  test("default view (PnL tab)", async ({ page }) => {
    await snap(page, "finance-main");
  });

  // All finance tabs
  const tabs = [
    { text: "Отчёты", name: "pnl" },
    { text: "По дням", name: "daily" },
    { text: "Артикулы", name: "articles" },
    { text: "Реклама", name: "ads" },
    { text: "Сверка", name: "reconciliation" },
    { text: "Прогноз", name: "forecast" },
  ];

  for (const tab of tabs) {
    test(`tab: ${tab.name}`, async ({ page }) => {
      await clickAndSnap(
        page,
        `button:has-text("${tab.text}"), [role="tab"]:has-text("${tab.text}")`,
        `finance-tab-${tab.name}`
      );
    });
  }

  // Date picker
  test("date range picker", async ({ page }) => {
    const dateBtn = page.locator('button:has-text("—"), [class*="date-range"]').first();
    if (await dateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dateBtn.click();
      await page.waitForTimeout(500);
      await snap(page, "finance-datepicker-open");
      await page.keyboard.press("Escape");
    }
  });

  // Articles tab - expand a row
  test("articles tab - expand row", async ({ page }) => {
    await page.click('button:has-text("Артикулы"), [role="tab"]:has-text("Артикулы")');
    await waitForStable(page);

    // Try to expand first article row
    const expandBtn = page.locator("table tbody tr").first();
    if (await expandBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(500);
      await snap(page, "finance-articles-expanded");
    }
  });

  // Filter dropdowns
  test("filter dropdowns render", async ({ page }) => {
    await page.click('button:has-text("Артикулы"), [role="tab"]:has-text("Артикулы")');
    await waitForStable(page);

    const selects = page.locator("select");
    const count = await selects.count();
    if (count > 0) {
      await selects.first().click();
      await page.waitForTimeout(300);
      await snap(page, "finance-filter-dropdown-open");
    }
  });
});

test.describe("Finance Sub-pages", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("tax settings page", async ({ page }) => {
    await page.goto("/finance/taxes");
    await waitForStable(page);
    await snap(page, "finance-taxes");
  });

  test("formulas page", async ({ page }) => {
    await page.goto("/finance/formulas");
    await waitForStable(page);
    await snap(page, "finance-formulas");
  });

  test("COGS settings page", async ({ page }) => {
    await page.goto("/finance/settings");
    await waitForStable(page);
    await snap(page, "finance-cogs-settings");
  });
});
