import { test, expect } from "@playwright/test";
import { snap } from "./helpers";

test.describe("Login Page", () => {
  test("renders login form", async ({ page }) => {
    await page.goto("/login");
    await snap(page, "login-form");
  });

  test("shows error on wrong credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="text"], input[type="email"], input[name="email"]', "wrong");
    await page.fill('input[type="password"]', "wrong");
    await page.click('button[type="submit"], button:has-text("Войти")');
    await page.waitForTimeout(2000);
    await snap(page, "login-error");
  });

  test("successful login redirects", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="text"], input[type="email"], input[name="email"]', "admin");
    await page.fill('input[type="password"]', "admin");
    await page.click('button[type="submit"], button:has-text("Войти")');
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10_000 });
    expect(page.url()).not.toContain("/login");
    await snap(page, "login-success-redirect");
  });
});
