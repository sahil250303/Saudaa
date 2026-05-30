const { chromium } = require('playwright');
const path = require('path');
const db = require('./db');

(async () => {
  let backup = null;
  
  console.log('Seeding temporary test database state...');
  try {
    const originalDB = await db.readDB();
    backup = JSON.parse(JSON.stringify(originalDB));
    
    // Seed test traders 'alex_pro' and 'echo_zulu'
    const testTraders = [
      {
        id: "alex_pro",
        name: "Alex Pro",
        strategy: "Algorithmic & Swing",
        winRate: 82.9,
        roi: 68.5,
        subscribers: 0,
        rank: 1,
        avatar: "",
        description: "Test Trader",
        status: "active",
        passwordHash: "70b320ca891d9d150f82c8d1903c7b668172449a14ffad98b528ef25efeb87540d20797dee16684baafed471f93d9ef11058c0416239ad14740235d8696ccf57",
        salt: "df98ab0ea9cd211933c9f2ca21578944"
      },
      {
        id: "echo_zulu",
        name: "EchoZulu",
        strategy: "Quant Strategy",
        winRate: 76.4,
        roi: 42.1,
        subscribers: 0,
        rank: 3,
        avatar: "",
        description: "Quant",
        status: "active",
        passwordHash: "493655a8b628ec51628a4fe6eb20011cc4d98a0f22039f3c12751e826f4881799e66b491da8c3a3fa08c88189abe3ea4a51063b94c965cef1fbbd7f170bd7c62",
        salt: "764e7214b845bd1820bdbfa31b7cc146"
      }
    ];

    const testSuggestions = [
      {
        id: "sig_1",
        traderId: "alex_pro",
        asset: "AAPL",
        type: "Buy",
        entry: "180.00",
        target: "190.00",
        stopLoss: "175.00",
        risk: "Medium",
        notes: "Test signal 1",
        createdAt: "2026-05-30T12:00:00.000Z"
      },
      {
        id: "sig_2",
        traderId: "alex_pro",
        asset: "MSFT",
        type: "Sell",
        entry: "420.00",
        target: "400.00",
        stopLoss: "430.00",
        risk: "High",
        notes: "Test signal 2",
        createdAt: "2026-05-30T12:05:00.000Z"
      },
      {
        id: "sig_3",
        traderId: "alex_pro",
        asset: "TSLA",
        type: "Buy",
        entry: "170.00",
        target: "185.00",
        stopLoss: "165.00",
        risk: "Low",
        notes: "Test signal 3",
        createdAt: "2026-05-30T12:10:00.000Z"
      }
    ];

    originalDB.traders = testTraders;
    originalDB.suggestions = testSuggestions;
    originalDB.clients = [];
    originalDB.payments = [];
    originalDB.messages = [];
    originalDB.freeSignals = [];
    
    await db.writeDB(originalDB);
    console.log('Seeding complete.');
  } catch (seedErr) {
    console.error('Failed to seed temporary database state:', seedErr);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Starting Security & Payments Verification System...');

  try {
    // ----------------------------------------------------
    // Test 1: Route Protection & 401 Unauthorized
    // ----------------------------------------------------
    console.log('\n--- Test 1: Route Protection ---');
    console.log('Fetching suggestions without Authorization header...');
    const suggestionsRes = await page.request.get('http://localhost:3000/api/suggestions?role=trader&userId=alex_pro');
    console.log('Status Code:', suggestionsRes.status());
    const suggestionsJson = await suggestionsRes.json();
    console.log('Response:', suggestionsJson);
    if (suggestionsRes.status() === 401 && suggestionsJson.error.includes('Access token required')) {
      console.log('SUCCESS: Route correctly protected with 401 Unauthorized!');
    } else {
      throw new Error('FAIL: Route is not properly locked down!');
    }

    // ----------------------------------------------------
    // Test 2: Secure JWT Login & Hashed Passwords
    // ----------------------------------------------------
    console.log('\n--- Test 2: JWT Login ---');
    console.log('Logging in as alex_pro...');
    const loginRes = await page.request.post('http://localhost:3000/api/auth/login', {
      data: { usernameOrEmail: 'alex_pro', password: 'password123' }
    });
    console.log('Status Code:', loginRes.status());
    const loginJson = await loginRes.json();
    console.log('Returned attributes (sans password):', Object.keys(loginJson));
    console.log('Is Token present:', !!loginJson.token);
    if (loginRes.status() === 200 && loginJson.token && loginJson.role === 'trader') {
      console.log('SUCCESS: Login succeeded and returned signed JWT token!');
    } else {
      throw new Error('FAIL: Login failed or did not return token!');
    }

    const token = loginJson.token;

    // ----------------------------------------------------
    // Test 3: Authenticated Fetch & Authorization Checks
    // ----------------------------------------------------
    console.log('\n--- Test 3: Authenticated Request ---');
    console.log('Fetching suggestions with valid Bearer token...');
    const authRes = await page.request.get('http://localhost:3000/api/suggestions?role=trader&userId=alex_pro', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status Code:', authRes.status());
    const authJson = await authRes.json();
    console.log('Signals returned count:', authJson.length);
    if (authRes.status() === 200 && Array.isArray(authJson)) {
      console.log('SUCCESS: Authenticated suggestion retrieval works!');
    } else {
      throw new Error('FAIL: Failed to fetch suggestions with valid token!');
    }

    console.log('\nCross-checking credentials mismatch (fetching echo_zulu signals using alex_pro token)...');
    const mismatchRes = await page.request.get('http://localhost:3000/api/suggestions?role=trader&userId=echo_zulu', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status Code:', mismatchRes.status());
    const mismatchJson = await mismatchRes.json();
    console.log('Response:', mismatchJson);
    if (mismatchRes.status() === 403 && mismatchJson.error.includes('Token credential mismatch')) {
      console.log('SUCCESS: API correctly blocks credential mismatch requests with 403 Forbidden!');
    } else {
      throw new Error('FAIL: Credential mismatch check failed!');
    }

    // ----------------------------------------------------
    // Test 4: Razorpay Order Creation API
    // ----------------------------------------------------
    console.log('\n--- Test 4: Payment Order Creation ---');
    console.log('Creating order for standard plan subscription...');
    const orderRes = await page.request.post('http://localhost:3000/api/payment/order', {
      data: { plan: 'standard', traderId: 'alex_pro' }
    });
    console.log('Status Code:', orderRes.status());
    const orderJson = await orderRes.json();
    console.log('Order Details:', orderJson);
    if (orderRes.status() === 200 && orderJson.orderId && orderJson.amount === 5900) {
      console.log('SUCCESS: Payment order created successfully with INR amount in paisa!');
    } else {
      throw new Error('FAIL: Order creation failed!');
    }

    // ----------------------------------------------------
    // Test 5: Sandbox Payment Subscription Process
    // ----------------------------------------------------
    console.log('\n--- Test 5: Sandbox Checkout & Subscription ---');
    console.log('Creating checkout subscription for a new user...');
    const subRes = await page.request.post('http://localhost:3000/api/subscribe', {
      data: {
        email: 'newtestuser@saudaa.com',
        password: 'SecurePassword123',
        traderId: 'alex_pro',
        plan: 'standard',
        orderId: orderJson.orderId,
        paymentId: 'pay_verify_mock_123',
        signature: 'sig_verify_mock_123'
      }
    });
    console.log('Status Code:', subRes.status());
    const subJson = await subRes.json();
    console.log('Subscription response details:', subJson);
    if (subRes.status() === 200 && subJson.success && subJson.subId) {
      console.log('SUCCESS: Sandbox subscription complete and subscriber ID issued!');
    } else {
      throw new Error('FAIL: Subscription creation failed!');
    }

    // ----------------------------------------------------
    // Test 6: DOM Verification - Credentials Helper Removal
    // ----------------------------------------------------
    console.log('\n--- Test 6: DOM Testing ---');
    console.log('Loading dashboard login page to verify credentials block is removed...');
    await page.goto('http://localhost:3000/dashboard.html');
    await page.waitForTimeout(1000);
    const hasCredentialsBlock = await page.evaluate(() => {
      return document.body.innerText.includes('💡 Quick Login Credentials for Testing') || 
             document.body.innerText.includes('alex_pro') || 
             document.body.innerText.includes('demo@saudaa.com');
    });
    console.log('[VERIFY] Exposed Credentials block present in DOM:', hasCredentialsBlock);
    if (!hasCredentialsBlock) {
      console.log('SUCCESS: Credentials block completely purged from the frontend DOM!');
    } else {
      throw new Error('FAIL: Exposed credentials block still rendered on screen!');
    }

    // ----------------------------------------------------
    // Test 7: Free Signals Route Protection (Unauthenticated POST)
    // ----------------------------------------------------
    console.log('\n--- Test 7: Free Signals Route Protection ---');
    console.log('Posting free signal without Authorization header...');
    const freeSigUnauthRes = await page.request.post('http://localhost:3000/api/free-signals', {
      data: { description: 'Test signal', timing: 'Immediate' }
    });
    console.log('Status Code:', freeSigUnauthRes.status());
    const freeSigUnauthJson = await freeSigUnauthRes.json();
    console.log('Response:', freeSigUnauthJson);
    if (freeSigUnauthRes.status() === 401 && freeSigUnauthJson.error && freeSigUnauthJson.error.includes('Access token required')) {
      console.log('SUCCESS: Free signals route correctly protected with 401 Unauthorized!');
    } else {
      throw new Error('FAIL: Free signals route is not properly protected!');
    }

    // ----------------------------------------------------
    // Test 8: Post Free Signal successfully
    // ----------------------------------------------------
    console.log('\n--- Test 8: Post Free Signal successfully ---');
    console.log('Posting first free signal with valid trader token...');
    const sig1Res = await page.request.post('http://localhost:3000/api/free-signals', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { description: 'Free Signal 1', timing: 'Buy AAPL at 180' }
    });
    console.log('Status Code:', sig1Res.status());
    const sig1Json = await sig1Res.json();
    console.log('Response:', sig1Json);
    if (sig1Res.status() === 200 && sig1Json.success && sig1Json.signal.description === 'Free Signal 1') {
      console.log('SUCCESS: Free signal 1 posted successfully!');
    } else {
      throw new Error('FAIL: Failed to post free signal 1!');
    }

    console.log('Posting second free signal...');
    const sig2Res = await page.request.post('http://localhost:3000/api/free-signals', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { description: 'Free Signal 2', timing: 'Buy MSFT at 420' }
    });
    if (sig2Res.status() !== 200) {
      throw new Error('FAIL: Failed to post free signal 2!');
    }

    console.log('Posting third free signal...');
    const sig3Res = await page.request.post('http://localhost:3000/api/free-signals', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { description: 'Free Signal 3', timing: 'Buy TSLA at 170' }
    });
    if (sig3Res.status() !== 200) {
      throw new Error('FAIL: Failed to post free signal 3!');
    }
    console.log('SUCCESS: Three free signals posted successfully!');

    // ----------------------------------------------------
    // Test 9: Free Signal Daily Limit (4th post fails)
    // ----------------------------------------------------
    console.log('\n--- Test 9: Free Signal Daily Limit ---');
    console.log('Posting fourth free signal (should fail)...');
    const sig4Res = await page.request.post('http://localhost:3000/api/free-signals', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { description: 'Free Signal 4', timing: 'Buy GOOG at 170' }
    });
    console.log('Status Code:', sig4Res.status());
    const sig4Json = await sig4Res.json();
    console.log('Response:', sig4Json);
    if (sig4Res.status() === 400 && sig4Json.error && sig4Json.error.includes('limit of 3 free signals')) {
      console.log('SUCCESS: Fourth free signal blocked with 400 Bad Request due to daily limit!');
    } else {
      throw new Error('FAIL: Fourth free signal was not blocked correctly!');
    }

    // ----------------------------------------------------
    // Test 10: GET Free Signals
    // ----------------------------------------------------
    console.log('\n--- Test 10: GET Free Signals ---');
    console.log('Retrieving free signals feed...');
    const getSigRes = await page.request.get('http://localhost:3000/api/free-signals');
    console.log('Status Code:', getSigRes.status());
    const getSigJson = await getSigRes.json();
    console.log('Active signals count:', getSigJson.length);
    if (getSigRes.status() === 200 && Array.isArray(getSigJson) && getSigJson.length === 3) {
      console.log('SUCCESS: GET free-signals returned active signals list of size 3!');
    } else {
      throw new Error('FAIL: Failed to retrieve active free signals list correctly!');
    }

    console.log('\n========================================');
    console.log('ALL SECURITY AND PAYMENTS VERIFICATIONS SUCCEEDED!');
    console.log('========================================');

  } catch (err) {
    console.error('\n[FATAL ERROR] Verification run failed:', err.message);
  } finally {
    await browser.close();
    if (backup) {
      console.log('\nRestoring original database state...');
      await db.writeDB(backup);
      console.log('Database restored.');
    }
  }
})();
