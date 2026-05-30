const { chromium } = require('playwright');
const path = require('path');

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
    await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
    
    console.log('Initial page load done. Checking preloader status...');
    let preloaderInfo = await page.evaluate(() => {
      const el = document.getElementById('preloader');
      if (!el) return 'No preloader element found!';
      return {
        id: el.id,
        className: el.className,
        style: el.getAttribute('style'),
        opacity: window.getComputedStyle(el).opacity,
        display: window.getComputedStyle(el).display,
        pointerEvents: window.getComputedStyle(el).pointerEvents,
        saText: document.getElementById('preloader-sa')?.textContent,
        barWidth: document.getElementById('preloader-bar')?.style.width
      };
    });
    console.log('Initial Preloader State:', preloaderInfo);

    console.log('Waiting 5 seconds for preloader fadeout...');
    await page.waitForTimeout(5000);

    let preloaderInfoAfter = await page.evaluate(() => {
      const el = document.getElementById('preloader');
      if (!el) return 'No preloader element found!';
      return {
        id: el.id,
        className: el.className,
        style: el.getAttribute('style'),
        opacity: window.getComputedStyle(el).opacity,
        display: window.getComputedStyle(el).display,
        pointerEvents: window.getComputedStyle(el).pointerEvents,
        saText: document.getElementById('preloader-sa')?.textContent,
        barWidth: document.getElementById('preloader-bar')?.style.width
      };
    });
    console.log('Preloader State after 5 seconds:', preloaderInfoAfter);

    const screenshotPath = path.join(__dirname, 'preloader_screenshot.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to: ${screenshotPath}`);

  } catch (e) {
    console.error(`Error: ${e.message}`);
  } finally {
    await browser.close();
  }
})();
