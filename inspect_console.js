const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Listening for console messages...');
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.error(`[PAGE ERROR]: ${err.toString()}`);
  });

  try {
    console.log('Navigating to http://localhost:3000/...');
    await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 10000 });
    console.log('Page loaded. Waiting 4 seconds...');
    await page.waitForTimeout(4000);
    console.log('Inspection finished.');
  } catch (e) {
    console.error(`Error during navigation: ${e.message}`);
  } finally {
    await browser.close();
  }
})();
