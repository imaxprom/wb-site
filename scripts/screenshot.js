#!/usr/bin/env node
/**
 * screenshot.js — Take screenshots of the site with persistent browser profile.
 * 
 * Usage:
 *   node scripts/screenshot.js [page] [output]
 *   node scripts/screenshot.js /shipment shipment.jpg
 *   node scripts/screenshot.js /finance finance.jpg
 * 
 * First run loads data from WB API and persists to IndexedDB.
 * Subsequent runs reuse the data.
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const PROFILE_DIR = "/Users/octopus/.puppeteer-profile";
const TOKEN_PATH = "/tmp/wb_token.txt";
const BASE_URL = "http://localhost:3000";

const pagePath = process.argv[2] || "/shipment";
const outputFile = process.argv[3] || "screenshot.jpg";
const outputPath = path.resolve(outputFile);

async function ensureData(pg) {
  // Check if data already loaded
  const hasData = await pg.evaluate(() => {
    return !document.body.innerText.includes("Нет данных для расчёта") &&
      !document.body.innerText.includes("Нет загруженных товаров");
  });

  if (hasData) {
    console.log("Data already loaded in profile");
    return;
  }

  // Set API key
  if (fs.existsSync(TOKEN_PATH)) {
    const token = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
    await pg.evaluate((t) => localStorage.setItem("wb-api-key", t), token);
    await pg.goto(BASE_URL + "/shipment", { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise((r) => setTimeout(r, 3000));

    // Click Upload tab
    await pg.evaluate(() => {
      for (const b of document.querySelectorAll("button")) {
        if (b.textContent.includes("Загрузка данных")) { b.click(); break; }
      }
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Click Load
    await pg.evaluate(() => {
      for (const b of document.querySelectorAll("button")) {
        if (b.textContent.includes("Загрузить всё")) { b.click(); break; }
      }
    });

    // Wait for data
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await pg.evaluate(() => document.body.innerText.includes("заказов"));
      if (s) { console.log("Data loaded from WB API"); break; }
      console.log(`Waiting... ${(i + 1) * 3}s`);
    }
    // Give IndexedDB time to flush to disk
    await new Promise((r) => setTimeout(r, 5000));
  } else {
    console.log("Data already in IndexedDB — skipping API load");
  }
}

async function checkIndexedDB(pg) {
  return pg.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open("wb-shipment", 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("app-data")) { resolve(false); return; }
        const tx = db.transaction("app-data", "readonly");
        tx.objectStore("app-data").get("stock").onsuccess = (e) => {
          const stock = e.target.result;
          resolve(stock && stock.length > 0);
        };
      };
      req.onerror = () => resolve(false);
    });
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "shell",
    userDataDir: PROFILE_DIR,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    protocolTimeout: 180000,
  });

  const pg = await browser.newPage();
  await pg.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  // Navigate to page
  await pg.goto(BASE_URL + pagePath, { waitUntil: "domcontentloaded", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));

  // Check if IndexedDB has data; if not, load from API
  const hasIDB = await checkIndexedDB(pg);
  if (!hasIDB) {
    await ensureData(pg);
  } else {
    console.log("Data found in IndexedDB profile");
  }

  // Navigate to target page (might have changed during data load)
  if (!pg.url().includes(pagePath)) {
    await pg.goto(BASE_URL + pagePath, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Click tab if specified in URL hash (e.g., /shipment#V3)
  const hash = pagePath.split("#")[1];
  if (hash) {
    await pg.evaluate((h) => {
      for (const b of document.querySelectorAll("button")) {
        if (b.textContent.includes(h)) { b.click(); break; }
      }
    }, hash);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Scale to fit if needed
  await pg.evaluate(() => {
    const h = document.body.scrollHeight;
    if (h > 1080) {
      const s = 1080 / h;
      document.body.style.transformOrigin = "top left";
      document.body.style.transform = `scale(${s})`;
      document.body.style.width = `${100 / s}%`;
      document.documentElement.style.overflow = "hidden";
    }
  });
  await new Promise((r) => setTimeout(r, 1000));

  const buf = await pg.screenshot({ type: "jpeg", quality: 85 });
  fs.writeFileSync(outputPath, buf);
  console.log(`Screenshot saved: ${outputPath} (${buf.length} bytes)`);

  await browser.close();
})();
