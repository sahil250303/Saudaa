const { chromium } = require('playwright');
const path = require('path');
const db = require('./db');

(async () => {
  let backup = null;
  
  console.log('Seeding temporary test database state...');
  try {
    const originalDB = await db.readDB();
    backup = JSON.parse(JSON.stringify(originalDB));
    
    // Seed test trader 'alex_pro' and client 'test1@gmail.com'
    const testTraders = [
      {
        id: "alex_pro",
        name: "Alex Pro",
        strategy: "Algorithmic & Swing",
        winRate: 82.9,
        roi: 68.5,
        subscribers: 1, // To reflect subscription
        rank: 1,
        avatar: "",
        description: "Test Trader",
        status: "active",
        passwordHash: "70b320ca891d9d150f82c8d1903c7b668172449a14ffad98b528ef25efeb87540d20797dee16684baafed471f93d9ef11058c0416239ad14740235d8696ccf57",
        salt: "df98ab0ea9cd211933c9f2ca21578944"
      }
    ];

    const testClients = [
      {
        id: "client_b9nt8f0l2",
        email: "test1@gmail.com",
        subId: "SA-1965-ELITE",
        subscription: {
          traderId: "alex_pro",
          plan: "pro",
          expiresAt: "2026-06-23T14:32:06.700Z"
        },
        passwordHash: "bdbfbb4a4eccdb0842c60d4a99eb2165792875d781e2cffb7dae859beacf8e5d23e0d10ca6c980e0fc0db588cf87f281667cc7f38604c687af79d25348784cb6",
        salt: "221bb21c262eb81c0cf2978134ea2f19",
        status: "active"
      }
    ];

    originalDB.traders = testTraders;
    originalDB.clients = testClients;
    originalDB.suggestions = [];
    originalDB.payments = [];
    originalDB.messages = [];
    
    await db.writeDB(originalDB);
    console.log('Seeding complete.');
  } catch (seedErr) {
    console.error('Failed to seed temporary database state:', seedErr);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport to a typical desktop size
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    // ----------------------------------------------------
    // Test 1: Homepage Load and Preloader
    // ----------------------------------------------------
    console.log('\n--- Test 1: Loading Homepage ---');
    console.log('Navigating to http://localhost:3000/');
    await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
    
    console.log('Waiting 4.5 seconds for preloader fadeout...');
    await page.waitForTimeout(4500);

    // Verify logo and title
    const docTitle = await page.title();
    console.log('[VERIFY] Document Title:', docTitle);

    // Check newly added sections
    const sections = await page.evaluate(() => {
      const works = !!document.getElementById('how-it-works');
      const pricing = !!document.getElementById('pricing');
      const test = !!document.getElementById('testimonials');
      const faq = !!document.getElementById('faq');
      const stickyCta = !!document.getElementById('mobile-sticky-cta');
      return { works, pricing, test, faq, stickyCta };
    });
    console.log('[VERIFY] Newly added landing page sections:', sections);

    // Take homepage screenshot
    const homeScreenshot = path.join(__dirname, 'verify_homepage.png');
    await page.screenshot({ path: homeScreenshot, fullPage: true });
    console.log(`[VERIFY] Homepage screenshot saved to: ${homeScreenshot}`);

    // ----------------------------------------------------
    // Test 2: Client Dashboard Login
    // ----------------------------------------------------
    console.log('\n--- Test 2: Client Dashboard Login ---');
    console.log('Navigating to http://localhost:3000/dashboard.html');
    await page.goto('http://localhost:3000/dashboard.html', { waitUntil: 'load', timeout: 15000 });

    // Verify login is visible
    let isLoginVisible = await page.isVisible('#login-container');
    console.log('[VERIFY] Login screen visible before auth:', isLoginVisible);

    console.log('Logging in as Client: test1@gmail.com');
    await page.fill('#login-username', 'test1@gmail.com');
    await page.fill('#login-password', 'Test@1234');
    await page.click('button[type="submit"]');

    // Wait for authentication and transition
    await page.waitForTimeout(2000);

    let isDashboardVisible = await page.isVisible('#dashboard-container');
    let isClientViewVisible = await page.isVisible('#view-client');
    console.log('[VERIFY] Client Dashboard visible:', isDashboardVisible);
    console.log('[VERIFY] Client Specific view visible:', isClientViewVisible);

    const clientHeaderDetails = await page.evaluate(() => {
      const title = document.getElementById('dash-welcome-title')?.innerText;
      const subtitle = document.getElementById('dash-welcome-subtitle')?.innerText;
      const traderName = document.getElementById('client-trader-name')?.innerText;
      return { title, subtitle, traderName };
    });
    console.log('[VERIFY] Client Dashboard UI Info:', clientHeaderDetails);

    // Take screenshot of Client Dashboard
    const clientScreenshot = path.join(__dirname, 'verify_client_dashboard.png');
    await page.screenshot({ path: clientScreenshot });
    console.log(`[VERIFY] Client Dashboard screenshot saved to: ${clientScreenshot}`);

    // Logout client
    console.log('Logging out client...');
    await page.click('button[onclick="handleLogout()"]');
    await page.waitForTimeout(1000);
    isLoginVisible = await page.isVisible('#login-container');
    console.log('[VERIFY] Returned to login container after logout:', isLoginVisible);

    // ----------------------------------------------------
    // Test 3: Trader Dashboard Login
    // ----------------------------------------------------
    console.log('\n--- Test 3: Trader Dashboard Login ---');
    console.log('Logging in as Trader: alex_pro');
    await page.fill('#login-username', 'alex_pro');
    await page.fill('#login-password', 'password123');
    await page.click('button[type="submit"]');

    // Wait for authentication and transition
    await page.waitForTimeout(2000);

    isDashboardVisible = await page.isVisible('#dashboard-container');
    let isTraderViewVisible = await page.isVisible('#view-trader');
    console.log('[VERIFY] Trader Dashboard visible:', isDashboardVisible);
    console.log('[VERIFY] Trader Specific view visible:', isTraderViewVisible);

    const traderHeaderDetails = await page.evaluate(() => {
      const title = document.getElementById('dash-welcome-title')?.innerText;
      const subText = document.getElementById('nav-user-sub')?.innerText;
      const winRate = document.getElementById('trader-stat-win')?.innerText;
      const subscribers = document.getElementById('trader-stat-subs')?.innerText;
      return { title, subText, winRate, subscribers };
    });
    console.log('[VERIFY] Trader Dashboard UI Info:', traderHeaderDetails);

    // Take screenshot of Trader Dashboard
    const traderScreenshot = path.join(__dirname, 'verify_trader_dashboard.png');
    await page.screenshot({ path: traderScreenshot });
    console.log(`[VERIFY] Trader Dashboard screenshot saved to: ${traderScreenshot}`);

    // Logout trader
    console.log('Logging out trader...');
    await page.click('button[onclick="handleLogout()"]');
    await page.waitForTimeout(1000);

    // ----------------------------------------------------
    // Test 4: Admin Portal Login Container
    // ----------------------------------------------------
    console.log('\n--- Test 4: Admin Portal Login ---');
    console.log('Navigating to http://localhost:3000/admin.html');
    await page.goto('http://localhost:3000/admin.html', { waitUntil: 'load', timeout: 15000 });

    const isAdminLoginVisible = await page.isVisible('#login-container');
    const adminTitle = await page.evaluate(() => {
      return document.querySelector('#login-container h1')?.innerText;
    });
    console.log('[VERIFY] Admin Login container visible:', isAdminLoginVisible);
    console.log('[VERIFY] Admin Header text:', adminTitle);

    // Take screenshot of Admin Portal Login
    const adminScreenshot = path.join(__dirname, 'verify_admin_login.png');
    await page.screenshot({ path: adminScreenshot });
    console.log(`[VERIFY] Admin Login screenshot saved to: ${adminScreenshot}`);

    console.log('\nVerification run finished successfully.');

  } catch (err) {
    console.error(`\n[ERROR] Verification script failed: ${err.message}`);
  } finally {
    await browser.close();
    if (backup) {
      console.log('\nRestoring original database state...');
      await db.writeDB(backup);
      console.log('Database restored.');
    }
  }
})();
