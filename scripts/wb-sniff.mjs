import puppeteer from 'puppeteer';
import fs from 'fs';

const browser = await puppeteer.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,900']
});

const page = (await browser.pages())[0];
await page.setViewport({ width: 1280, height: 800 });
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

const client = await page.createCDPSession();
await client.send('Network.enable');

const requests = [];

client.on('Network.requestWillBeSent', (params) => {
  const url = params.request.url;
  if (url.includes('/auth/') || url.includes('/code/')) {
    requests.push({
      url,
      method: params.request.method,
      headers: params.request.headers,
      body: params.request.postData || null,
    });
    console.log(`\n>>> ${params.request.method} ${url}`);
    console.log('Headers:', JSON.stringify(params.request.headers, null, 2));
    if (params.request.postData) {
      console.log('Body:', params.request.postData);
    }
  }
});

client.on('Network.responseReceived', (params) => {
  const url = params.response.url;
  if (url.includes('/auth/') || url.includes('/code/')) {
    console.log(`\n<<< ${params.response.status} ${url}`);
  }
});

await page.goto('https://seller-auth.wildberries.ru/', { waitUntil: 'networkidle2', timeout: 30000 });

console.log('\n=== Страница загружена. Введи номер в браузере. ===');
console.log('=== Все /auth/ запросы будут перехвачены. ===');
console.log('=== Ctrl+C когда закончишь. ===\n');

// Keep alive 5 min
await new Promise(r => setTimeout(r, 300000));

fs.writeFileSync('data/wb-sniffed-requests.json', JSON.stringify(requests, null, 2));
console.log('Saved to data/wb-sniffed-requests.json');
await browser.close();
