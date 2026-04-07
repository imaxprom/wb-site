import { Page, expect } from "@playwright/test";

/**
 * Login and store session cookie.
 * Default credentials: admin / admin (from shipment-db default user).
 */
export async function login(page: Page, email = "admin", password = "admin") {
  // Retry login up to 3 times in case server is temporarily unavailable
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto("/login", { timeout: 15_000, waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      await page.fill('input[type="text"], input[type="email"], input[name="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"], button:has-text("Войти")');
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForTimeout(3_000);
    }
  }
}

/**
 * Take a full-page screenshot and compare against baseline.
 * Name should be descriptive, e.g. "analytics-main".
 */
export async function snap(page: Page, name: string) {
  // Wait for network to settle and animations to finish
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500); // allow CSS transitions
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
  });
}

/**
 * Take a screenshot of a specific element.
 */
export async function snapElement(page: Page, selector: string, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
  const el = page.locator(selector).first();
  await expect(el).toBeVisible({ timeout: 5_000 });
  await expect(el).toHaveScreenshot(`${name}.png`, { animations: "disabled" });
}

/**
 * Click a tab/button and wait for content to settle, then screenshot.
 */
export async function clickAndSnap(page: Page, selector: string, snapName: string) {
  await page.click(selector);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  await snap(page, snapName);
}

/**
 * Safely click if element exists. Returns true if clicked.
 */
export async function clickIfExists(page: Page, selector: string): Promise<boolean> {
  const el = page.locator(selector).first();
  if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await el.click();
    return true;
  }
  return false;
}

/**
 * Wait for page to be fully loaded (no spinners, no loading text).
 */
export async function waitForStable(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Wait for common loading indicators to disappear
  const spinners = page.locator('text="Загрузка"').first();
  await spinners.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(300);
}
