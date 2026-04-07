import { test } from "@playwright/test";
import { login, snap, clickAndSnap, waitForStable, clickIfExists } from "./helpers";

test.describe("Changelog Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/changelog");
    await waitForStable(page);
  });

  test("changelog main view", async ({ page }) => {
    await snap(page, "changelog-main");
  });

  test("tab: changes", async ({ page }) => {
    await clickAndSnap(
      page,
      'button:has-text("Изменения"), [role="tab"]:has-text("Изменения")',
      "changelog-tab-changes"
    );
  });

  test("tab: backlog", async ({ page }) => {
    await clickAndSnap(
      page,
      'button:has-text("Доработки")',
      "changelog-tab-backlog"
    );
  });

  // Filter dropdown
  test("section filter", async ({ page }) => {
    const select = page.locator("select").first();
    if (await select.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await select.selectOption({ index: 1 });
      await page.waitForTimeout(500);
      await snap(page, "changelog-filtered");
    }
  });
});

test.describe("Docs Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/docs");
    await waitForStable(page);
  });

  test("docs main view", async ({ page }) => {
    await snap(page, "docs-main");
  });

  // Expand code blocks
  test("expand code blocks", async ({ page }) => {
    const expandBtn = page.locator('button:has-text("Показать"), button:has-text("Код"), button:has-text("Развернуть")').first();
    if (await expandBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(500);
      await snap(page, "docs-code-expanded");
    }
  });

  // Navigate between sections
  test("section navigation", async ({ page }) => {
    const sections = page.locator("nav a, [class*='sidebar'] a, [class*='menu'] a");
    const count = await sections.count();
    if (count > 1) {
      await sections.nth(1).click();
      await page.waitForTimeout(500);
      await snap(page, "docs-section-2");
    }
  });
});
