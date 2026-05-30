const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

// In-memory sessions for admin
const tempTokens = new Map(); // token -> { expiresAt }
const activeAdminTokens = new Set();


// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const { readDB, writeDB } = require('./db.js');

// Native JWT implementation using HMAC-SHA256
const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[SECURITY WARNING] SESSION_SECRET environment variable is missing. Generated a random session secret.');
}

function generateSessionToken(user, role) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    id: user.id,
    email: user.email || user.id,
    role: role,
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours expiration
  };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET)
                          .update(`${base64Header}.${base64Payload}`)
                          .digest('base64url');
  return `${base64Header}.${base64Payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', JWT_SECRET)
                                .update(`${header}.${payload}`)
                                .digest('base64url');
  if (signature !== expectedSignature) return null;
  try {
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decodedPayload.exp < Date.now()) return null;
    return decodedPayload;
  } catch (e) {
    return null;
  }
}

// User Authentication Middleware
async function verifyUserToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required. Please log in.' });
  }
  const token = authHeader.substring(7);
  const decoded = verifySessionToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Session expired or invalid. Please log in again.' });
  }
  req.user = decoded; // Contains id, email, role
  next();
}

// Password Scrypt Hashing Helpers
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const inputHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return inputHash === hash;
}

// Password migration on startup
async function migrateDatabasePasswords() {
  const db = await readDB();
  let updated = false;

  if (db.traders) {
    db.traders.forEach(t => {
      if (t.password && !t.passwordHash) {
        const salt = crypto.randomBytes(16).toString('hex');
        t.passwordHash = hashPassword(t.password, salt);
        t.salt = salt;
        delete t.password;
        updated = true;
      }
    });
  }

  if (db.clients) {
    db.clients.forEach(c => {
      if (c.password && !c.passwordHash) {
        const salt = crypto.randomBytes(16).toString('hex');
        c.passwordHash = hashPassword(c.password, salt);
        c.salt = salt;
        delete c.password;
        updated = true;
      }
    });
  }

  if (updated) {
    await writeDB(db);
    console.log('[SECURITY] Completed startup database password scrypt hashing migration.');
  }
}

// Admin & MFA Security Helpers
async function initAdminDB() {
  const db = await readDB();
  let updated = false;

  if (!db.admin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    let adminPass = process.env.ADMIN_PASSWORD;
    if (!adminPass) {
      adminPass = crypto.randomBytes(12).toString('hex');
      console.warn(`[SECURITY WARNING] ADMIN_PASSWORD environment variable is not set. Generated dynamic admin password for startup seeding: ${adminPass}`);
    }
    const hash = crypto.scryptSync(adminPass, salt, 64).toString('hex');
    db.admin = {
      username: adminUser,
      salt: salt,
      passwordHash: hash,
      mfaSecret: crypto.randomBytes(20).toString('hex')
    };
    updated = true;
    console.log('[INIT] Default admin account seeded.');
  }

  if (!db.plans) {
    db.plans = [
      { id: "standard", name: "Standard Plan", price: 59, features: ["General Community Access", "Standard Signals List"] },
      { id: "pro", name: "Pro Elite Plan", price: 99, features: ["1-on-1 Private Trader Chat", "Advanced Signals Feed"] },
      { id: "vip", name: "VIP Plan", price: 249, features: ["Access to 10 Trader Dashboards", "Option Hedging Insights"] }
    ];
    updated = true;
    console.log('[INIT] Default plans seeded.');
  }

  if (!db.payments) {
    db.payments = [];
    updated = true;
    console.log('[INIT] Default payments list seeded.');
  }

  if (updated) {
    await writeDB(db);
  }
}

function generateTOTPWithCounter(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(counter, 4);
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(buf);
  const hmacResult = hmac.digest();
  
  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  const binary = ((hmacResult[offset] & 0x7f) << 24) |
                 ((hmacResult[offset + 1] & 0xff) << 16) |
                 ((hmacResult[offset + 2] & 0xff) << 8) |
                 (hmacResult[offset + 3] & 0xff);
                 
  const code = binary % 1000000;
  return code.toString().padStart(6, '0');
}

function generateTOTP(secret) {
  const counter = Math.floor(Date.now() / 30000);
  return generateTOTPWithCounter(secret, counter);
}

// Database will be initialized asynchronously in the startServer wrapper at startup


// Helper to generate a subscription premium ID
function generatePremiumID() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `SA-${num}-ELITE`;
}

// Live Market Stock Data Strip Configuration & Background Poller
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || 'VX8H607E3Y6T4M2B';
const symbols = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN'];
let currentSymbolIndex = 0;
let apiRateLimited = false;

let stockCache = {
  timestamp: new Date().toISOString(),
  source: 'simulated',
  data: {
    AAPL: { price: 189.84, change: 1.24, changePercent: 0.66 },
    MSFT: { price: 421.90, change: -0.85, changePercent: -0.20 },
    TSLA: { price: 174.60, change: 2.45, changePercent: 1.42 },
    NVDA: { price: 948.79, change: 15.30, changePercent: 1.64 },
    AMZN: { price: 181.28, change: -1.12, changePercent: -0.61 }
  }
};

function fetchStockQuote(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function updateNextStock() {
  if (apiRateLimited) return;
  
  const symbol = symbols[currentSymbolIndex];
  currentSymbolIndex = (currentSymbolIndex + 1) % symbols.length;

  try {
    const json = await fetchStockQuote(symbol);
    if (json['Global Quote'] && json['Global Quote']['05. price']) {
      const quote = json['Global Quote'];
      const price = parseFloat(quote['05. price']);
      const change = parseFloat(quote['09. change']);
      const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));
      
      stockCache.data[symbol] = { price, change, changePercent };
      stockCache.timestamp = new Date().toISOString();
      stockCache.source = 'api';
    } else if (json['Note'] || json['Information'] || json['Error Message']) {
      console.warn(`Alpha Vantage API warning or rate limit detected for ${symbol}:`, json);
      apiRateLimited = true;
      stockCache.source = 'simulated';
    }
  } catch (error) {
    console.error(`Error fetching stock quote for ${symbol}:`, error);
    apiRateLimited = true;
    stockCache.source = 'simulated';
  }
}

// Update one stock every 12 seconds to respect 5 req/min limit
setInterval(updateNextStock, 12000);
// Trigger initial fetch
updateNextStock();

// Auto-reset rate limit flag every 5 minutes to attempt recovery
setInterval(() => {
  if (apiRateLimited) {
    console.log('Attempting to resume Alpha Vantage API calls...');
    apiRateLimited = false;
  }
}, 300000);

// API Routes

// Live Market Ticker Endpoint (no browser caching)
app.get('/api/market-strip', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (stockCache.source === 'simulated' || apiRateLimited) {
    // Fluctuate prices slightly on every client request to feel real-time
    Object.keys(stockCache.data).forEach(symbol => {
      const changePercent = (Math.random() - 0.5) * 0.15; // -0.075% to +0.075%
      const currentPrice = stockCache.data[symbol].price;
      const delta = currentPrice * (changePercent / 100);
      stockCache.data[symbol].price = parseFloat((currentPrice + delta).toFixed(2));
      
      stockCache.data[symbol].change = parseFloat((stockCache.data[symbol].change + delta).toFixed(2));
      stockCache.data[symbol].changePercent = parseFloat((stockCache.data[symbol].changePercent + changePercent).toFixed(2));
    });
    stockCache.timestamp = new Date().toISOString();
    stockCache.source = 'simulated';
  }

  res.json(stockCache);
});

// 1. Get all traders (sans sensitive data)
app.get('/api/traders', async (req, res) => {
  const db = await readDB();
  const safeTraders = db.traders.map(({ password, passwordHash, salt, ...rest }) => rest);
  res.json(safeTraders);
});

// 2. Authentication Login (Trader or Client)
app.post('/api/auth/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required.' });
  }

  const db = await readDB();

  // Check if trader
  const trader = db.traders.find(t => t.id === usernameOrEmail);
  if (trader) {
    const isPasswordValid = trader.passwordHash
      ? verifyPassword(password, trader.salt, trader.passwordHash)
      : (trader.password === password); // Startup fallback

    if (isPasswordValid) {
      const { password: _, passwordHash: __, salt: ___, ...traderProfile } = trader;
      const token = generateSessionToken(trader, 'trader');
      return res.json({
        role: 'trader',
        token: token,
        user: traderProfile
      });
    }
  }

  // Check if client (either by email or subId)
  const client = db.clients.find(c => 
    c.email.toLowerCase() === usernameOrEmail.toLowerCase() || c.subId === usernameOrEmail
  );
  if (client) {
    if (client.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
    }

    const isPasswordValid = client.passwordHash
      ? verifyPassword(password, client.salt, client.passwordHash)
      : (client.password === password); // Startup fallback

    if (isPasswordValid) {
      const token = generateSessionToken(client, 'client');
      return res.json({
        role: 'client',
        token: token,
        user: {
          id: client.id,
          email: client.email,
          subId: client.subId,
          subscription: client.subscription
        }
      });
    }
  }

  return res.status(401).json({ error: 'Invalid credentials. Please verify your ID/email and password.' });
});

// 3. Register Client (Static profile setup)
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = await readDB();
  const exists = db.clients.find(c => c.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: 'A user with this email already exists.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  const newClient = {
    id: 'client_' + Math.random().toString(36).substr(2, 9),
    email: email.toLowerCase(),
    passwordHash: passwordHash,
    salt: salt,
    subId: generatePremiumID(),
    subscription: null,
    status: 'active'
  };

  db.clients.push(newClient);
  await writeDB(db);

  res.json({
    success: true,
    user: {
      id: newClient.id,
      email: newClient.email,
      subId: newClient.subId,
      subscription: null
    }
  });
});

// 4. Payment Gateway Mock & Subscription Creation
const Razorpay = require('razorpay');

let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
  console.log('[PAYMENT] Razorpay Gateway initialized.');
} else {
  console.warn('[PAYMENT] Razorpay credentials missing. Running in Sandbox Payment mode.');
}

// 4. Payment Gateway Order Creation
app.post('/api/payment/order', async (req, res) => {
  const { plan, traderId } = req.body;
  if (!plan || !traderId) {
    return res.status(400).json({ error: 'Missing plan or traderId details.' });
  }

  const db = await readDB();
  const planDetails = db.plans ? db.plans.find(p => p.id === plan) : null;
  const price = planDetails ? planDetails.price : (plan === 'standard' ? 59 : plan === 'pro' ? 99 : plan === 'vip' ? 249 : 99);

  if (razorpay) {
    try {
      const options = {
        amount: price * 100, // amount in paisa
        currency: 'INR',
        receipt: 'rcpt_' + Math.random().toString(36).substr(2, 9),
        notes: { plan, traderId }
      };
      const order = await razorpay.orders.create(options);
      return res.json({
        source: 'razorpay',
        orderId: order.id,
        amount: options.amount,
        keyId: process.env.RAZORPAY_KEY_ID
      });
    } catch (err) {
      console.error('Error creating Razorpay Order:', err);
      return res.status(500).json({ error: 'Failed to create payment order via Razorpay.' });
    }
  } else {
    // Sandbox mode
    return res.json({
      source: 'sandbox',
      orderId: 'order_mock_' + Math.random().toString(36).substr(2, 9),
      amount: price * 100,
      keyId: 'mock_key_id'
    });
  }
});

// 4b. Subscription Creation (Verifying signature and generating client login)
app.post('/api/subscribe', async (req, res) => {
  const { email, password, traderId, plan, paymentId, orderId, signature } = req.body;

  if (!email || !password || !traderId || !plan) {
    return res.status(400).json({ error: 'Required fields missing: email, password, traderId, plan.' });
  }

  // Payment verification
  if (razorpay && (!paymentId || !orderId || !signature)) {
    return res.status(400).json({ error: 'Payment details (paymentId, orderId, signature) are required.' });
  }

  if (razorpay) {
    // Verify Razorpay signature
    const generatedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                      .update(orderId + "|" + paymentId)
                                      .digest('hex');
    if (generatedSignature !== signature) {
      return res.status(400).json({ error: 'Payment signature verification failed. Untrusted source.' });
    }
  }

  const db = await readDB();
  
  // Verify trader exists
  const trader = db.traders.find(t => t.id === traderId);
  if (!trader) {
    return res.status(404).json({ error: 'Selected trader not found.' });
  }

  let client = db.clients.find(c => c.email.toLowerCase() === email.toLowerCase());

  if (client) {
    // Verify client password before updating subscription
    const isPasswordValid = client.passwordHash
      ? verifyPassword(password, client.salt, client.passwordHash)
      : (client.password === password); // legacy fallback

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Incorrect password for this existing client account.' });
    }

    // Update existing client subscription
    client.subscription = {
      traderId: traderId,
      plan: plan,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
    };
  } else {
    // Create new client with secure scrypt password hash
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    client = {
      id: 'client_' + Math.random().toString(36).substr(2, 9),
      email: email.toLowerCase(),
      passwordHash: passwordHash,
      salt: salt,
      subId: generatePremiumID(),
      subscription: {
        traderId: traderId,
        plan: plan,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      status: 'active'
    };
    db.clients.push(client);
  }

  // Increment trader subscriber count
  trader.subscribers += 1;

  // Log payment details
  const planDetails = db.plans ? db.plans.find(p => p.id === plan) : null;
  const price = planDetails ? planDetails.price : (plan === 'pro' ? 99 : plan === 'vip' ? 249 : 59);

  const newPayment = {
    id: 'pay_' + (paymentId || 'mock_' + Math.random().toString(36).substr(2, 9)),
    email: email.toLowerCase(),
    subId: client.subId,
    traderId: traderId,
    traderName: trader.name,
    plan: plan,
    amount: price,
    timestamp: new Date().toISOString(),
    status: 'success'
  };

  if (!db.payments) {
    db.payments = [];
  }
  db.payments.unshift(newPayment);

  await writeDB(db);

  res.json({
    success: true,
    subId: client.subId,
    email: client.email,
    password: password, // Reflect back selected password for client success UI display
    traderName: trader.name,
    plan: plan
  });
});

// 5. Get Trading Suggestions
app.get('/api/suggestions', verifyUserToken, async (req, res) => {
  const { role, userId } = req.query;
  const db = await readDB();

  // Cross check credentials
  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'Access denied. Token credential mismatch.' });
  }

  if (req.user.role === 'trader') {
    // Trader fetching their own signals
    const signals = db.suggestions.filter(s => s.traderId === req.user.id);
    return res.json(signals);
  }

  if (req.user.role === 'client') {
    // Client fetching signals. Must check client subscription
    const client = db.clients.find(c => c.id === req.user.id);
    if (!client || !client.subscription) {
      return res.status(403).json({ error: 'No active subscription found. Subscribe to a trader to view signals.' });
    }
    const signals = db.suggestions.filter(s => s.traderId === client.subscription.traderId);
    return res.json(signals);
  }

  return res.status(400).json({ error: 'Invalid suggestions request query.' });
});

// 6. Post suggestion (Trader only)
app.post('/api/suggestions', verifyUserToken, async (req, res) => {
  const { traderId, asset, type, entry, target, stopLoss, risk, notes, assetType, strategy } = req.body;

  if (req.user.role !== 'trader' || req.user.id !== traderId) {
    return res.status(403).json({ error: 'Unauthorized user credentials to broadcast signals.' });
  }

  if (!traderId || !asset || !type || !entry || !target || !stopLoss || !risk) {
    return res.status(400).json({ error: 'All signal details are required.' });
  }

  const db = await readDB();
  const trader = db.traders.find(t => t.id === traderId);
  if (!trader) {
    return res.status(404).json({ error: 'Only authorized active traders can post signals.' });
  }

  const newSignal = {
    id: 'sig_' + Math.random().toString(36).substr(2, 9),
    traderId,
    asset,
    type,
    entry,
    target,
    stopLoss,
    risk,
    assetType: assetType || 'Stocks',
    strategy: strategy || 'Day Trade',
    notes: notes || '',
    createdAt: new Date().toISOString()
  };

  db.suggestions.unshift(newSignal);
  await writeDB(db);

  res.json({ success: true, signal: newSignal });
});

// 7. Edit suggestion (Trader only)
app.put('/api/suggestions/:id', verifyUserToken, async (req, res) => {
  const { id } = req.params;
  const { traderId, asset, type, entry, target, stopLoss, risk, notes, assetType, strategy } = req.body;

  if (req.user.role !== 'trader' || req.user.id !== traderId) {
    return res.status(403).json({ error: 'Unauthorized credentials to modify signals.' });
  }

  if (!traderId || !asset || !type || !entry || !target || !stopLoss || !risk) {
    return res.status(400).json({ error: 'All signal details are required.' });
  }

  const db = await readDB();
  const suggestion = db.suggestions.find(s => s.id === id && s.traderId === traderId);
  
  if (!suggestion) {
    return res.status(404).json({ error: 'Signal not found or unauthorized.' });
  }

  const elapsedMs = Date.now() - new Date(suggestion.createdAt).getTime();
  if (elapsedMs > 120000) {
    return res.status(400).json({ error: 'Suggestions can only be edited within 2 minutes of creation.' });
  }

  suggestion.asset = asset;
  suggestion.type = type;
  suggestion.entry = entry;
  suggestion.target = target;
  suggestion.stopLoss = stopLoss;
  suggestion.risk = risk;
  suggestion.assetType = assetType || 'Stocks';
  suggestion.strategy = strategy || 'Day Trade';
  suggestion.notes = notes || '';
  suggestion.edited = true;

  await writeDB(db);
  res.json({ success: true, signal: suggestion });
});

// 8. Delete/Archive suggestion (Trader only)
app.delete('/api/suggestions/:id', verifyUserToken, async (req, res) => {
  const { id } = req.params;
  const { traderId } = req.query;

  if (req.user.role !== 'trader' || req.user.id !== traderId) {
    return res.status(403).json({ error: 'Unauthorized credentials to remove signals.' });
  }

  const db = await readDB();
  const index = db.suggestions.findIndex(s => s.id === id && s.traderId === traderId);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Signal not found or unauthorized.' });
  }

  const elapsedMs = Date.now() - new Date(db.suggestions[index].createdAt).getTime();
  if (elapsedMs > 120000) {
    return res.status(400).json({ error: 'Suggestions can only be deleted within 2 minutes of creation.' });
  }

  db.suggestions.splice(index, 1);
  await writeDB(db);

  res.json({ success: true });
});

// 8. Fetch Chat Messages (1-on-1 between Client and Trader)
app.get('/api/chat/messages', verifyUserToken, async (req, res) => {
  const { clientId, traderId } = req.query;

  if (!clientId || !traderId) {
    return res.status(400).json({ error: 'clientId and traderId parameters are required.' });
  }

  // Verify request is authorized for these participants
  if (req.user.id !== clientId && req.user.id !== traderId) {
    return res.status(403).json({ error: 'Access denied. You cannot view chat history of other participants.' });
  }

  const db = await readDB();
  const chatLogs = db.messages.filter(m => 
    m.traderId === traderId && 
    ((m.senderId === clientId && m.receiverId === traderId) || 
     (m.senderId === traderId && m.receiverId === clientId))
  );

  res.json(chatLogs);
});

// 9. Send Chat Message
app.post('/api/chat/send', verifyUserToken, async (req, res) => {
  const { senderId, receiverId, traderId, content } = req.body;

  if (req.user.id !== senderId) {
    return res.status(403).json({ error: 'Access denied. Sender identity mismatch.' });
  }

  if (!senderId || !receiverId || !traderId || !content) {
    return res.status(400).json({ error: 'Missing chat fields: senderId, receiverId, traderId, content.' });
  }

  const db = await readDB();
  const newMsg = {
    id: 'msg_' + Math.random().toString(36).substr(2, 9),
    senderId,
    receiverId,
    traderId,
    content,
    timestamp: new Date().toISOString()
  };

  db.messages.push(newMsg);
  await writeDB(db);

  res.json(newMsg);
});

// 10. Trader clients endpoint: List all clients subscribed to a specific trader
app.get('/api/traders/:id/clients', verifyUserToken, async (req, res) => {
  const traderId = req.params.id;

  if (req.user.role !== 'trader' || req.user.id !== traderId) {
    return res.status(403).json({ error: 'Access denied. Only the trader can inspect their subscribers.' });
  }

  const db = await readDB();

  const subscribedClients = db.clients
    .filter(c => c.subscription && c.subscription.traderId === traderId)
    .map(c => ({
      id: c.id,
      email: c.email,
      subId: c.subId,
      plan: c.subscription.plan,
      expiresAt: c.subscription.expiresAt
    }));

  res.json(subscribedClients);
});

// Public Endpoint for Subscription Plans
app.get('/api/plans', async (req, res) => {
  const db = await readDB();
  res.json(db.plans || []);
});

// Daily Free Signals GET Endpoint
app.get('/api/free-signals', async (req, res) => {
  const db = await readDB();
  res.json(db.freeSignals || []);
});

// Daily Free Signals POST Endpoint
app.post('/api/free-signals', verifyUserToken, async (req, res) => {
  if (req.user.role !== 'trader') {
    return res.status(403).json({ error: 'Only authorized traders can broadcast free signals.' });
  }

  const { description, timing } = req.body;
  if (!description || !timing) {
    return res.status(400).json({ error: 'Description and timing fields are required.' });
  }

  const db = await readDB();
  const trader = db.traders.find(t => t.id === req.user.id);
  if (!trader) {
    return res.status(404).json({ error: 'Trader profile not found.' });
  }

  // Calculate signals posted today by this trader (YYYY-MM-DD format in UTC)
  const todayStr = new Date().toISOString().substring(0, 10);
  const todaySignalsCount = (db.freeSignals || []).filter(s => 
    s.traderId === req.user.id && 
    s.createdAt && s.createdAt.startsWith(todayStr)
  ).length;

  if (todaySignalsCount >= 3) {
    return res.status(400).json({ error: 'You have reached your daily limit of 3 free signals.' });
  }

  const freeSigId = 'free_' + crypto.randomBytes(8).toString('hex');
  const newFreeSignal = {
    id: freeSigId,
    traderId: trader.id,
    traderName: trader.name,
    description: description.trim(),
    timing: timing.trim(),
    createdAt: new Date().toISOString()
  };

  if (!db.freeSignals) {
    db.freeSignals = [];
  }
  db.freeSignals.unshift(newFreeSignal);

  await writeDB(db);

  res.json({
    success: true,
    signal: newFreeSignal,
    countToday: todaySignalsCount + 1
  });
});

// Admin Token Authentication Middleware
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  const token = authHeader.substring(7);
  if (!activeAdminTokens.has(token)) {
    return res.status(403).json({ error: 'Access denied. Invalid or expired session.' });
  }
  next();
}

// 11. Admin Login Step 1: Credentials verification
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const db = await readDB();
  if (!db.admin) {
    return res.status(500).json({ error: 'Admin database not initialized.' });
  }

  if (username !== db.admin.username) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  // Verify password using scryptSync
  const calculatedHash = crypto.scryptSync(password, db.admin.salt, 64).toString('hex');
  if (calculatedHash !== db.admin.passwordHash) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  // Credentials correct. Generate temporary MFA token
  const tempToken = 'temp_' + crypto.randomBytes(32).toString('hex');
  tempTokens.set(tempToken, { expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 minutes

  // Generate current MFA code
  const code = generateTOTP(db.admin.mfaSecret);
  console.log(`\n========================================`);
  console.log(`[SECURITY] Admin Login MFA Code generated.`);
  console.log(`Current MFA Verification Code: ${code}`);
  console.log(`========================================\n`);

  res.json({ success: true, tempToken });
});

// 12. Admin Login Step 2: MFA Verification
app.post('/api/admin/mfa-verify', async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) {
    return res.status(400).json({ error: 'tempToken and MFA code are required.' });
  }

  const session = tempTokens.get(tempToken);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'MFA verification session expired or invalid.' });
  }

  const db = await readDB();
  const currentCode = generateTOTP(db.admin.mfaSecret);
  const lastCounter = Math.floor(Date.now() / 30000) - 1;
  const lastCode = generateTOTPWithCounter(db.admin.mfaSecret, lastCounter);

  if (code !== currentCode && code !== lastCode) {
    return res.status(401).json({ error: 'Invalid MFA verification code.' });
  }

  // Upgrade to active admin session token
  const adminToken = 'adm_' + crypto.randomBytes(32).toString('hex');
  activeAdminTokens.add(adminToken);

  // Clean up temp token
  tempTokens.delete(tempToken);

  res.json({ success: true, adminToken });
});

// Developer convenience endpoint to retrieve MFA code (enabled for testing in our dev environment)
app.get('/api/admin/dev-mfa', async (req, res) => {
  const db = await readDB();
  if (!db.admin) {
    return res.status(500).json({ error: 'Admin database not initialized.' });
  }
  const code = generateTOTP(db.admin.mfaSecret);
  res.json({ code });
});

// 13. Admin Endpoint: List all clients (omitting password hash)
app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
  const db = await readDB();
  const safeClients = db.clients.map(({ password, passwordHash, salt, ...rest }) => rest);
  res.json(safeClients);
});

// 14. Admin Endpoint: Toggle client suspension status
app.post('/api/admin/users/toggle-status', verifyAdminToken, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required.' });
  }

  const db = await readDB();
  const client = db.clients.find(c => c.id === clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client account not found.' });
  }

  client.status = (client.status === 'suspended') ? 'active' : 'suspended';
  await writeDB(db);

  res.json({ success: true, status: client.status });
});

// 15. Admin Endpoint: Get payment history list
app.get('/api/admin/payments', verifyAdminToken, async (req, res) => {
  const db = await readDB();
  res.json(db.payments || []);
});

// 16. Admin Endpoint: List all traders (omitting passwords)
app.get('/api/admin/traders', verifyAdminToken, async (req, res) => {
  const db = await readDB();
  const safeTraders = db.traders.map(({ password, passwordHash, salt, ...rest }) => rest);
  res.json(safeTraders);
});

// 17. Admin Endpoint: Create or edit trader account details
app.post('/api/admin/traders/save', verifyAdminToken, async (req, res) => {
  const { id, name, strategy, roi, winRate, description, avatar, password } = req.body;
  if (!id || !name || !strategy || roi === undefined || winRate === undefined) {
    return res.status(400).json({ error: 'Required fields missing: id, name, strategy, roi, winRate.' });
  }

  const db = await readDB();
  let trader = db.traders.find(t => t.id === id);

  if (trader) {
    // Edit existing trader
    trader.name = name;
    trader.strategy = strategy;
    trader.roi = parseFloat(roi);
    trader.winRate = parseFloat(winRate);
    trader.description = description || '';
    if (avatar) trader.avatar = avatar;
    if (password) {
      const salt = crypto.randomBytes(16).toString('hex');
      trader.passwordHash = hashPassword(password, salt);
      trader.salt = salt;
      delete trader.password;
    }
  } else {
    // Create new trader with secure scrypt password hash
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password || 'password123', salt);
    trader = {
      id,
      name,
      strategy,
      roi: parseFloat(roi),
      winRate: parseFloat(winRate),
      subscribers: 0,
      rank: db.traders.length + 1,
      passwordHash,
      salt,
      avatar: avatar || 'https://lh3.googleusercontent.com/aida-public/AB6AXuD4ldlC0l7f1tSED1_SV3GL0xoo88STemly3M1OWj7KXnBSGx3FOy1ibN3I8CAdbvXcMr0EhcaC30eQD1c8cszwgm5jOfDYFqjyQKdcNYboXZIVx3qHAdskzLrWDKLGrJA1IFL0TBlWZesDmebt2VBE2RP3Nbx6OpXX8LS5KhzLbYrnOzl32yFmpH62dyctK8cduk9P6mecSjqgi3IhboN6Io2SIBa4CQzaPPFR6QL_NHZYyhXKY0fp53-OBgznwXPD-cnk9NqC3sw',
      description: description || '',
      status: 'active'
    };
    db.traders.push(trader);
  }

  // Sort and re-rank traders based on ROI descending
  db.traders.sort((a, b) => b.roi - a.roi);
  db.traders.forEach((t, i) => t.rank = i + 1);

  await writeDB(db);
  res.json({ success: true, trader: { id: trader.id, name: trader.name } });
});

// 18. Admin Endpoint: Delete or toggle active status of a trader
app.post('/api/admin/traders/toggle-status', verifyAdminToken, async (req, res) => {
  const { traderId, action } = req.body;
  if (!traderId) {
    return res.status(400).json({ error: 'traderId is required.' });
  }

  const db = await readDB();
  const index = db.traders.findIndex(t => t.id === traderId);
  if (index === -1) {
    return res.status(404).json({ error: 'Trader account not found.' });
  }

  if (action === 'delete') {
    db.traders.splice(index, 1);
    // Sort and re-rank
    db.traders.sort((a, b) => b.roi - a.roi);
    db.traders.forEach((t, i) => t.rank = i + 1);
    await writeDB(db);
    return res.json({ success: true, deleted: true });
  } else {
    const trader = db.traders[index];
    trader.status = (trader.status === 'suspended') ? 'active' : 'suspended';
    await writeDB(db);
    return res.json({ success: true, status: trader.status });
  }
});

// 19. Admin Endpoint: Update subscription plans pricing and features list
app.post('/api/admin/plans/update', verifyAdminToken, async (req, res) => {
  const { plans } = req.body;
  if (!plans || !Array.isArray(plans)) {
    return res.status(400).json({ error: 'Plans array is required.' });
  }

  const db = await readDB();
  db.plans = plans;
  await writeDB(db);

  res.json({ success: true, plans: db.plans });
});

// Fallback HTML router
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server with async Database initialization
async function startServer() {
  try {
    await initAdminDB();
    await migrateDatabasePasswords();
    app.listen(PORT, () => {
      console.log(`Saudaa Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize database and start server:', error);
    process.exit(1);
  }
}
startServer();

