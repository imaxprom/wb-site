import { test } from "@playwright/test";
import { login, snap, clickAndSnap, waitForStable } from "./helpers";

test.describe("Shipment Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/shipment");
    await waitForStable(page);
  });

  test("default view (calc tab)", async ({ page }) => {
    await snap(page, "shipment-main");
  });

  // Tab navigation
  const tabs = [
    { text: "Расчёт", name: "calc" },
    { text: "Товары", name: "products" },
    { text: "Загрузка", name: "upload" },
    { text: "Настройки", name: "settings" },
  ];

  for (const tab of tabs) {
    test(`tab: ${tab.name}`, async ({ page }) => {
      await clickAndSnap(
        page,
        `button:has-text("${tab.text}"), [role="tab"]:has-text("${tab.text}")`,
        `shipment-tab-${tab.name}`
      );
    });
  }

  // Calc mode buttons
  test("calc mode V1", async ({ page }) => {
    await clickAndSnap(
      page,
      'button:has-text("V1"), button:has-text("Стандарт")',
      "shipment-calc-v1"
    );
  });

  test("calc mode V2", async ({ page }) => {
    await clickAndSnap(
      page,
      'button:has-text("V2"), button:has-text("Динамика")',
      "shipment-calc-v2"
    );
  });

  test("calc mode V3", async ({ page }) => {
    await clickAndSnap(
      page,
      'button:has-text("V3"), button:has-text("Умный")',
      "shipment-calc-v3"
    );
  });

  // Settings tab interactions
  test("settings tab - region groups", async ({ page }) => {
    await page.click('button:has-text("Настройки"), [role="tab"]:has-text("Настройки")');
    await waitForStable(page);
    await snap(page, "shipment-settings-full");
  });
});
