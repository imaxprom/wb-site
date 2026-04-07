# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-finance.spec.ts >> Finance Page >> articles tab - expand row
- Location: e2e/05-finance.spec.ts:47:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/login
Call log:
  - navigating to "http://localhost:3000/login", waiting until "domcontentloaded"

```

# Test source

```ts
  1  | import { Page, expect } from "@playwright/test";
  2  | 
  3  | /**
  4  |  * Login and store session cookie.
  5  |  * Default credentials: admin / admin (from shipment-db default user).
  6  |  */
  7  | export async function login(page: Page, email = "admin", password = "admin") {
  8  |   // Retry login up to 3 times in case server is temporarily unavailable
  9  |   for (let attempt = 0; attempt < 3; attempt++) {
  10 |     try {
> 11 |       await page.goto("/login", { timeout: 15_000, waitUntil: "domcontentloaded" });
     |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/login
  12 |       await page.waitForTimeout(500);
  13 |       await page.fill('input[type="text"], input[type="email"], input[name="email"]', email);
  14 |       await page.fill('input[type="password"]', password);
  15 |       await page.click('button[type="submit"], button:has-text("Войти")');
  16 |       await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 });
  17 |       return;
  18 |     } catch (err) {
  19 |       if (attempt === 2) throw err;
  20 |       await page.waitForTimeout(3_000);
  21 |     }
  22 |   }
  23 | }
  24 | 
  25 | /**
  26 |  * Take a full-page screenshot and compare against baseline.
  27 |  * Name should be descriptive, e.g. "analytics-main".
  28 |  */
  29 | export async function snap(page: Page, name: string) {
  30 |   // Wait for network to settle and animations to finish
  31 |   await page.waitForLoadState("networkidle").catch(() => {});
  32 |   await page.waitForTimeout(500); // allow CSS transitions
  33 |   await expect(page).toHaveScreenshot(`${name}.png`, {
  34 |     fullPage: true,
  35 |     animations: "disabled",
  36 |   });
  37 | }
  38 | 
  39 | /**
  40 |  * Take a screenshot of a specific element.
  41 |  */
  42 | export async function snapElement(page: Page, selector: string, name: string) {
  43 |   await page.waitForLoadState("networkidle").catch(() => {});
  44 |   await page.waitForTimeout(300);
  45 |   const el = page.locator(selector).first();
  46 |   await expect(el).toBeVisible({ timeout: 5_000 });
  47 |   await expect(el).toHaveScreenshot(`${name}.png`, { animations: "disabled" });
  48 | }
  49 | 
  50 | /**
  51 |  * Click a tab/button and wait for content to settle, then screenshot.
  52 |  */
  53 | export async function clickAndSnap(page: Page, selector: string, snapName: string) {
  54 |   await page.click(selector);
  55 |   await page.waitForLoadState("networkidle").catch(() => {});
  56 |   await page.waitForTimeout(500);
  57 |   await snap(page, snapName);
  58 | }
  59 | 
  60 | /**
  61 |  * Safely click if element exists. Returns true if clicked.
  62 |  */
  63 | export async function clickIfExists(page: Page, selector: string): Promise<boolean> {
  64 |   const el = page.locator(selector).first();
  65 |   if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
  66 |     await el.click();
  67 |     return true;
  68 |   }
  69 |   return false;
  70 | }
  71 | 
  72 | /**
  73 |  * Wait for page to be fully loaded (no spinners, no loading text).
  74 |  */
  75 | export async function waitForStable(page: Page) {
  76 |   await page.waitForLoadState("networkidle").catch(() => {});
  77 |   // Wait for common loading indicators to disappear
  78 |   const spinners = page.locator('text="Загрузка"').first();
  79 |   await spinners.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  80 |   await page.waitForTimeout(300);
  81 | }
  82 | 
```