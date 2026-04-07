import { test } from "@playwright/test";
import { login, snap, waitForStable, clickIfExists } from "./helpers";

test.describe("Products Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/products");
    await waitForStable(page);
  });

  test("main products list", async ({ page }) => {
    await snap(page, "products-main");
  });

  // Expand a product row
  test("expand product details", async ({ page }) => {
    const row = page.locator("table tbody tr, [class*='product']").first();
    if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await row.click();
      await page.waitForTimeout(500);
      await snap(page, "products-expanded-row");
    }
  });

  // Toggle empty products
  test("toggle empty products", async ({ page }) => {
    const toggle = page.locator('button:has-text("без остатков"), button:has-text("Показать все")').first();
    if (await toggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
      await snap(page, "products-show-empty");
    }
  });
});
