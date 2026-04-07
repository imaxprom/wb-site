import { test } from "@playwright/test";
import { login, snap, clickAndSnap } from "./helpers";

test.describe("Sidebar Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  const navLinks = [
    { name: "analytics", text: "Аналитика", url: "/analytics" },
    { name: "reviews", text: "Отзывы", url: "/reviews" },
    { name: "finance", text: "Финансы", url: "/finance" },
    { name: "monitor", text: "Мониторинг", url: "/monitor" },
    { name: "shipment", text: "Расчёт", url: "/shipment" },
    { name: "changelog", text: "Журнал", url: "/changelog" },
    { name: "docs", text: "База знаний", url: "/docs" },
    { name: "settings", text: "Настройки", url: "/settings" },
  ];

  for (const link of navLinks) {
    test(`navigate to ${link.name}`, async ({ page }) => {
      // Click sidebar link
      const navItem = page.locator(`a[href="${link.url}"]`).first();
      if (await navItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await navItem.click();
      } else {
        // Try by text
        await page.click(`text="${link.text}"`);
      }
      await page.waitForURL((url) => url.pathname.startsWith(link.url), { timeout: 10_000 });
      await snap(page, `sidebar-nav-${link.name}`);
    });
  }
});
