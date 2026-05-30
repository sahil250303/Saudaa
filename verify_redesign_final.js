const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Navigating to http://localhost:3000/...');
  try {
    await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
    
    // Wait for preloader to hide
    console.log('Waiting 4 seconds for preloader fadeout...');
    await page.waitForTimeout(4000);

    // 1. Verify How it Works section is present
    const hasHowItWorks = await page.evaluate(() => {
      const el = document.getElementById('how-it-works');
      return !!el;
    });
    console.log('[VERIFY] How it Works section exists:', hasHowItWorks);

    // 2. Verify Pricing section is present and shows prices
    const pricingInfo = await page.evaluate(() => {
      const el = document.getElementById('pricing');
      const standard = document.getElementById('price-standard')?.innerText;
      const pro = document.getElementById('price-pro')?.innerText;
      const vip = document.getElementById('price-vip')?.innerText;
      return { exists: !!el, standard, pro, vip };
    });
    console.log('[VERIFY] Pricing Section:', pricingInfo);

    // 3. Verify Testimonials section is present
    const hasTestimonials = await page.evaluate(() => {
      const el = document.getElementById('testimonials');
      return !!el;
    });
    console.log('[VERIFY] Testimonials Section exists:', hasTestimonials);

    // 4. Verify FAQ section is present and click FAQ 1 to open it
    const faqInfoBefore = await page.evaluate(() => {
      const el = document.getElementById('faq');
      const ans1 = document.getElementById('faq-ans-1');
      return { exists: !!el, ans1VisibleBefore: !ans1.classList.contains('hidden') };
    });
    console.log('[VERIFY] FAQ Section:', faqInfoBefore);

    // Click FAQ 1
    console.log('Clicking FAQ 1 to toggle accordion...');
    await page.evaluate(() => {
      window.toggleFaq(1);
    });
    await page.waitForTimeout(500);

    const faqInfoAfter = await page.evaluate(() => {
      const ans1 = document.getElementById('faq-ans-1');
      return { ans1VisibleAfter: !ans1.classList.contains('hidden') };
    });
    console.log('[VERIFY] FAQ 1 after click:', faqInfoAfter);

    // 5. Verify Mobile Sticky CTA is present
    const hasMobileCta = await page.evaluate(() => {
      const el = document.getElementById('mobile-sticky-cta');
      return !!el;
    });
    console.log('[VERIFY] Mobile Sticky CTA exists:', hasMobileCta);

    // Take screenshot of home page layout
    const screenshotPath = path.join(__dirname, 'verify_redesign_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Verification completed successfully. Screenshot saved to: ${screenshotPath}`);

  } catch (e) {
    console.error(`Verification failed with error: ${e.message}`);
  } finally {
    await browser.close();
  }
})();
