# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-finance.spec.ts >> Finance Page >> tab: reconciliation
- Location: e2e/05-finance.spec.ts:26:9

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  Expected an image 1464px by 1258px, received 1440px by 900px. 547575 pixels (ratio 0.30 of all image pixels) are different.

  Snapshot: finance-tab-reconciliation.png

Call log:
  - Expect "toHaveScreenshot(finance-tab-reconciliation.png)" with timeout 15000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - Expected an image 1464px by 1258px, received 1440px by 900px. 547575 pixels (ratio 0.30 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - Expected an image 1464px by 1258px, received 1440px by 900px. 547575 pixels (ratio 0.30 of all image pixels) are different.

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - img "MpHub" [ref=e5]
      - navigation [ref=e6]:
        - link "Аналитика" [ref=e7] [cursor=pointer]:
          - /url: /analytics
        - link "Отзывы" [ref=e8] [cursor=pointer]:
          - /url: /reviews
          - img [ref=e9]
          - text: Отзывы
        - link "Финансы" [ref=e11] [cursor=pointer]:
          - /url: /finance
        - link "Мониторинг" [ref=e12] [cursor=pointer]:
          - /url: /monitor
        - link "Расчёт отгрузки" [ref=e13] [cursor=pointer]:
          - /url: /shipment
        - link "Журнал" [ref=e14] [cursor=pointer]:
          - /url: /changelog
        - link "База знаний" [ref=e15] [cursor=pointer]:
          - /url: /docs
        - link "Настройки" [ref=e16] [cursor=pointer]:
          - /url: /settings
    - main [ref=e17]:
      - generic [ref=e18]:
        - generic [ref=e19]:
          - generic [ref=e20]:
            - heading "Период" [level=2] [ref=e21]
            - button "05.03.2026 — 03.04.2026" [ref=e22] [cursor=pointer]
          - generic [ref=e23]:
            - link "📦 Себестоимость" [ref=e24] [cursor=pointer]:
              - /url: /finance/settings
            - link "🧾 Налоги" [ref=e25] [cursor=pointer]:
              - /url: /finance/taxes
            - link "📐 Формулы" [ref=e26] [cursor=pointer]:
              - /url: /finance/formulas
        - generic [ref=e27]:
          - button "Отчёты" [ref=e28]
          - button "По дням" [ref=e29]
          - button "Артикулы" [ref=e30]
          - button "Реклама" [ref=e31]
          - button "Сверка" [active] [ref=e32]
          - button "Прогноз" [ref=e33]
        - generic [ref=e34]:
          - generic [ref=e35]:
            - button "29.03 – 04.04⏳" [ref=e36]
            - button "23.03 – 29.03✅" [ref=e37]
          - generic [ref=e38]:
            - generic [ref=e39]:
              - heading "Сверка за 23.03 – 29.03" [level=3] [ref=e40]
              - generic [ref=e41]:
                - generic [ref=e42]: "API недельный: ✅ загружен"
                - generic [ref=e43]: "Excel ЛК: ✅ загружен"
                - generic [ref=e44]: "7 дней ежедневный: ✅ есть"
            - table [ref=e45]:
              - rowgroup [ref=e46]:
                - row "Метрика API недельный Excel ЛК Разница API/Excel 7 дней ежедневный Разница API/Daily" [ref=e47]:
                  - columnheader "Метрика" [ref=e48]
                  - columnheader "API недельный" [ref=e49]
                  - columnheader "Excel ЛК" [ref=e50]
                  - columnheader "Разница API/Excel" [ref=e51]
                  - columnheader "7 дней ежедневный" [ref=e52]
                  - columnheader "Разница API/Daily" [ref=e53]
              - rowgroup [ref=e54]:
                - row "Кол-во продаж 6 440 6 442 -2 (-0.0%) 6 440 ✅" [ref=e55]:
                  - cell "Кол-во продаж" [ref=e56]
                  - cell "6 440" [ref=e57]
                  - cell "6 442" [ref=e58]
                  - cell "-2 (-0.0%)" [ref=e59]
                  - cell "6 440" [ref=e60]
                  - cell "✅" [ref=e61]
                - row "Кол-во возвратов 29 29 ✅ 29 ✅" [ref=e62]:
                  - cell "Кол-во возвратов" [ref=e63]
                  - cell "29" [ref=e64]
                  - cell "29" [ref=e65]
                  - cell "✅" [ref=e66]
                  - cell "29" [ref=e67]
                  - cell "✅" [ref=e68]
                - row "Цена розничная с учётом согласованной скидки (продажи) 6 920 768 ₽ 6 922 716 ₽ -1 948 ₽ (-0.0%) 6 920 768 ₽ ✅" [ref=e69]:
                  - cell "Цена розничная с учётом согласованной скидки (продажи)" [ref=e70]
                  - cell "6 920 768 ₽" [ref=e71]
                  - cell "6 922 716 ₽" [ref=e72]
                  - cell "-1 948 ₽ (-0.0%)" [ref=e73]
                  - cell "6 920 768 ₽" [ref=e74]
                  - cell "✅" [ref=e75]
                - row "Цена розничная с учётом согласованной скидки (возвраты) 28 728 ₽ 28 728 ₽ ✅ 28 728 ₽ ✅" [ref=e76]:
                  - cell "Цена розничная с учётом согласованной скидки (возвраты)" [ref=e77]
                  - cell "28 728 ₽" [ref=e78]
                  - cell "28 728 ₽" [ref=e79]
                  - cell "✅" [ref=e80]
                  - cell "28 728 ₽" [ref=e81]
                  - cell "✅" [ref=e82]
                - row "К перечислению Продавцу за реализованный Товар (продажи) 4 306 164 ₽ 4 307 376 ₽ -1 212 ₽ (-0.0%) 4 306 164 ₽ ✅" [ref=e83]:
                  - cell "К перечислению Продавцу за реализованный Товар (продажи)" [ref=e84]
                  - cell "4 306 164 ₽" [ref=e85]
                  - cell "4 307 376 ₽" [ref=e86]
                  - cell "-1 212 ₽ (-0.0%)" [ref=e87]
                  - cell "4 306 164 ₽" [ref=e88]
                  - cell "✅" [ref=e89]
                - row "К перечислению Продавцу за реализованный Товар (возвраты) 17 836 ₽ 17 836 ₽ ✅ 17 836 ₽ ✅" [ref=e90]:
                  - cell "К перечислению Продавцу за реализованный Товар (возвраты)" [ref=e91]
                  - cell "17 836 ₽" [ref=e92]
                  - cell "17 836 ₽" [ref=e93]
                  - cell "✅" [ref=e94]
                  - cell "17 836 ₽" [ref=e95]
                  - cell "✅" [ref=e96]
                - row "Услуги по доставке товара покупателю 847 929 ₽ 847 929 ₽ ✅ 847 929 ₽ ✅" [ref=e97]:
                  - cell "Услуги по доставке товара покупателю" [ref=e98]
                  - cell "847 929 ₽" [ref=e99]
                  - cell "847 929 ₽" [ref=e100]
                  - cell "✅" [ref=e101]
                  - cell "847 929 ₽" [ref=e102]
                  - cell "✅" [ref=e103]
                - row "Количество доставок 7 893 7 893 ✅ 7 893 ✅" [ref=e104]:
                  - cell "Количество доставок" [ref=e105]
                  - cell "7 893" [ref=e106]
                  - cell "7 893" [ref=e107]
                  - cell "✅" [ref=e108]
                  - cell "7 893" [ref=e109]
                  - cell "✅" [ref=e110]
                - row "Количество возвратов (доставка) 1 465 1 465 ✅ 1 465 ✅" [ref=e111]:
                  - cell "Количество возвратов (доставка)" [ref=e112]
                  - cell "1 465" [ref=e113]
                  - cell "1 465" [ref=e114]
                  - cell "✅" [ref=e115]
                  - cell "1 465" [ref=e116]
                  - cell "✅" [ref=e117]
                - row "Хранение 53 659 ₽ 53 659 ₽ ✅ 53 659 ₽ ✅" [ref=e118]:
                  - cell "Хранение" [ref=e119]
                  - cell "53 659 ₽" [ref=e120]
                  - cell "53 659 ₽" [ref=e121]
                  - cell "✅" [ref=e122]
                  - cell "53 659 ₽" [ref=e123]
                  - cell "✅" [ref=e124]
                - row "Общая сумма штрафов 1 140 ₽ 1 140 ₽ ✅ 1 140 ₽ ✅" [ref=e125]:
                  - cell "Общая сумма штрафов" [ref=e126]
                  - cell "1 140 ₽" [ref=e127]
                  - cell "1 140 ₽" [ref=e128]
                  - cell "✅" [ref=e129]
                  - cell "1 140 ₽" [ref=e130]
                  - cell "✅" [ref=e131]
                - row "Операции на приёмке 150 ₽ 150 ₽ ✅ 150 ₽ ✅" [ref=e132]:
                  - cell "Операции на приёмке" [ref=e133]
                  - cell "150 ₽" [ref=e134]
                  - cell "150 ₽" [ref=e135]
                  - cell "✅" [ref=e136]
                  - cell "150 ₽" [ref=e137]
                  - cell "✅" [ref=e138]
                - row "Удержания (WB Продвижение) 493 913 ₽ 493 913 ₽ ✅ 493 913 ₽ ✅" [ref=e139]:
                  - cell "Удержания (WB Продвижение)" [ref=e140]
                  - cell "493 913 ₽" [ref=e141]
                  - cell "493 913 ₽" [ref=e142]
                  - cell "✅" [ref=e143]
                  - cell "493 913 ₽" [ref=e144]
                  - cell "✅" [ref=e145]
                - row "Возмещение издержек по перевозке 105 117 ₽ 105 117 ₽ ✅ 105 117 ₽ ✅" [ref=e146]:
                  - cell "Возмещение издержек по перевозке" [ref=e147]
                  - cell "105 117 ₽" [ref=e148]
                  - cell "105 117 ₽" [ref=e149]
                  - cell "✅" [ref=e150]
                  - cell "105 117 ₽" [ref=e151]
                  - cell "✅" [ref=e152]
                - row "Эквайринг / Комиссии за организацию платежей 175 720 ₽ 175 720 ₽ ✅ 49 ₽ +175 671 ₽ (358512.2%)" [ref=e153]:
                  - cell "Эквайринг / Комиссии за организацию платежей" [ref=e154]
                  - cell "175 720 ₽" [ref=e155]
                  - cell "175 720 ₽" [ref=e156]
                  - cell "✅" [ref=e157]
                  - cell "49 ₽" [ref=e158]
                  - cell "+175 671 ₽ (358512.2%)" [ref=e159]
                - row "Компенсация скидки по программе лояльности — 4 354 ₽ — 4 354 ₽ —" [ref=e160]:
                  - cell "Компенсация скидки по программе лояльности" [ref=e161]
                  - cell "—" [ref=e162]
                  - cell "4 354 ₽" [ref=e163]
                  - cell "—" [ref=e164]
                  - cell "4 354 ₽" [ref=e165]
                  - cell "—" [ref=e166]
            - paragraph [ref=e168]: "API vs Excel: ✅ Сходится — общая разница 0.06%"
  - button "Open Next.js Dev Tools" [ref=e174] [cursor=pointer]:
    - img [ref=e175]
  - alert [ref=e178]
  - generic [ref=e179]: "0"
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
  11 |       await page.goto("/login", { timeout: 15_000, waitUntil: "domcontentloaded" });
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
> 33 |   await expect(page).toHaveScreenshot(`${name}.png`, {
     |                      ^ Error: expect(page).toHaveScreenshot(expected) failed
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