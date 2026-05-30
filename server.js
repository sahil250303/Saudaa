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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Helpers
function readDB() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database file:', error);
    return { traders: [], suggestions: [], clients: [], messages: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing to database file:', error);
  }
}

// Admin & MFA Security Helpers
function initAdminDB() {
  const db = readDB();
  let updated = false;

  if (!db.admin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'adminPassword123';
    const hash = crypto.scryptSync(adminPass, salt, 64).toString('hex');
    db.admin = {
      username: adminUser,
      salt: salt,
      passwordHash: hash,
      mfaSecret: crypto.randomBytes(20).toString('hex')
    };
    updated = true;
    console.log('[INIT] Default admin account seeded in database.json');
  }

  if (!db.plans) {
    db.plans = [
      { id: "standard", name: "Standard Plan", price: 49, features: ["General Community Access", "Standard Signals List"] },
      { id: "pro", name: "Pro Elite Plan", price: 99, features: ["1-on-1 Private Trader Chat", "Advanced Signals Feed"] },
      { id: "vip", name: "VIP Plan", price: 249, features: ["Access to 10 Trader Dashboards", "Option Hedging Insights"] }
    ];
    updated = true;
    console.log('[INIT] Default plans seeded in database.json');
  }

  if (!db.payments) {
    db.payments = [];
    updated = true;
    console.log('[INIT] Default payments list seeded in database.json');
  }

  if (updated) {
    writeDB(db);
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

// Call database initialization
initAdminDB();

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
  source: 'api',
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

// 1. Get all traders (sans passwords)
app.get('/api/traders', (req, res) => {
  const db = readDB();
  const safeTraders = db.traders.map(({ password, ...rest }) => rest);
  res.json(safeTraders);
});

// 2. Authentication Login (Trader or Client)
app.post('/api/auth/login', (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required.' });
  }

  const db = readDB();

  // Check if trader
  const trader = db.traders.find(t => t.id === usernameOrEmail && t.password === password);
  if (trader) {
    const { password: _, ...traderProfile } = trader;
    return res.json({
      role: 'trader',
      user: traderProfile
    });
  }

  // Check if client (either by email or subId)
  const client = db.clients.find(c => 
    (c.email.toLowerCase() === usernameOrEmail.toLowerCase() || c.subId === usernameOrEmail) && 
    c.password === password
  );
  if (client) {
    if (client.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
    }
    return res.json({
      role: 'client',
      user: {
        id: client.id,
        email: client.email,
        subId: client.subId,
        subscription: client.subscription
      }
    });
  }

  return res.status(401).json({ error: 'Invalid credentials. Please verify your ID/email and password.' });
});

// 3. Register Client (Static profile setup)
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = readDB();
  const exists = db.clients.find(c => c.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: 'A user with this email already exists.' });
  }

  const newClient = {
    id: 'client_' + Math.random().toString(36).substr(2, 9),
    email: email.toLowerCase(),
    password: password,
    subId: generatePremiumID(),
    subscription: null
  };

  db.clients.push(newClient);
  writeDB(db);

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
app.post('/api/subscribe', (req, res) => {
  const { email, password, traderId, plan, cardNumber, expiry, cvc } = req.body;

  if (!email || !password || !traderId || !plan) {
    return res.status(400).json({ error: 'Required fields missing: email, password, traderId, plan.' });
  }

  // Simple card check simulation
  if (!cardNumber || cardNumber.replace(/\s/g, '').length < 16) {
    return res.status(400).json({ error: 'Invalid card number details.' });
  }

  const db = readDB();
  
  // Verify trader exists
  const trader = db.traders.find(t => t.id === traderId);
  if (!trader) {
    return res.status(404).json({ error: 'Selected trader not found.' });
  }

  let client = db.clients.find(c => c.email.toLowerCase() === email.toLowerCase());

  if (client) {
    // Update existing client subscription
    client.subscription = {
      traderId: traderId,
      plan: plan,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
    };
  } else {
    // Create new client
    client = {
      id: 'client_' + Math.random().toString(36).substr(2, 9),
      email: email.toLowerCase(),
      password: password,
      subId: generatePremiumID(),
      subscription: {
        traderId: traderId,
        plan: plan,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    };
    db.clients.push(client);
  }

  // Increment trader subscriber count
  trader.subscribers += 1;

  // Log payment details
  const planDetails = db.plans ? db.plans.find(p => p.id === plan) : null;
  const price = planDetails ? planDetails.price : (plan === 'pro' ? 99 : plan === 'vip' ? 249 : 49);

  const newPayment = {
    id: 'pay_' + Math.random().toString(36).substr(2, 9),
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

  writeDB(db);

  res.json({
    success: true,
    subId: client.subId,
    email: client.email,
    password: client.password,
    traderName: trader.name,
    plan: plan
  });
});

// 5. Get Trading Suggestions
app.get('/api/suggestions', (req, res) => {
  const { role, userId, traderId } = req.query;
  const db = readDB();

  if (role === 'trader' && userId) {
    // Trader fetching their own signals
    const signals = db.suggestions.filter(s => s.traderId === userId);
    return res.json(signals);
  }

  if (role === 'client' && userId) {
    // Client fetching signals. Must check client subscription
    const client = db.clients.find(c => c.id === userId);
    if (!client || !client.subscription) {
      return res.status(403).json({ error: 'No active subscription found. Subscribe to a trader to view signals.' });
    }
    const signals = db.suggestions.filter(s => s.traderId === client.subscription.traderId);
    return res.json(signals);
  }

  // Fallback: anonymous list or filtered by trader
  if (traderId) {
    const signals = db.suggestions.filter(s => s.traderId === traderId);
    return res.json(signals);
  }

  res.json(db.suggestions);
});

// 6. Post suggestion (Trader only)
app.post('/api/suggestions', (req, res) => {
  const { traderId, asset, type, entry, target, stopLoss, risk, notes, assetType, strategy } = req.body;

  if (!traderId || !asset || !type || !entry || !target || !stopLoss || !risk) {
    return res.status(400).json({ error: 'All signal details are required.' });
  }

  const db = readDB();
  const trader = db.traders.find(t => t.id === traderId);
  if (!trader) {
    return res.status(403).json({ error: 'Only authorized traders can post signals.' });
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
  writeDB(db);

  res.json({ success: true, signal: newSignal });
});

// 7. Edit suggestion (Trader only)
app.put('/api/suggestions/:id', (req, res) => {
  const { id } = req.params;
  const { traderId, asset, type, entry, target, stopLoss, risk, notes, assetType, strategy } = req.body;

  if (!traderId || !asset || !type || !entry || !target || !stopLoss || !risk) {
    return res.status(400).json({ error: 'All signal details are required.' });
  }

  const db = readDB();
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

  writeDB(db);
  res.json({ success: true, signal: suggestion });
});

// 8. Delete/Archive suggestion (Trader only)
app.delete('/api/suggestions/:id', (req, res) => {
  const { id } = req.params;
  const { traderId } = req.query;

  if (!traderId) {
    return res.status(400).json({ error: 'Trader Authorization required.' });
  }

  const db = readDB();
  const index = db.suggestions.findIndex(s => s.id === id && s.traderId === traderId);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Signal not found or unauthorized.' });
  }

  const elapsedMs = Date.now() - new Date(db.suggestions[index].createdAt).getTime();
  if (elapsedMs > 120000) {
    return res.status(400).json({ error: 'Suggestions can only be deleted within 2 minutes of creation.' });
  }

  db.suggestions.splice(index, 1);
  writeDB(db);

  res.json({ success: true });
});

// 8. Fetch Chat Messages (1-on-1 between Client and Trader)
app.get('/api/chat/messages', (req, res) => {
  const { clientId, traderId } = req.query;

  if (!clientId || !traderId) {
    return res.status(400).json({ error: 'clientId and traderId parameters are required.' });
  }

  const db = readDB();
  const chatLogs = db.messages.filter(m => 
    m.traderId === traderId && 
    ((m.senderId === clientId && m.receiverId === traderId) || 
     (m.senderId === traderId && m.receiverId === clientId))
  );

  res.json(chatLogs);
});

// 9. Send Chat Message
app.post('/api/chat/send', (req, res) => {
  const { senderId, receiverId, traderId, content } = req.body;

  if (!senderId || !receiverId || !traderId || !content) {
    return res.status(400).json({ error: 'Missing chat fields: senderId, receiverId, traderId, content.' });
  }

  const db = readDB();
  const newMsg = {
    id: 'msg_' + Math.random().toString(36).substr(2, 9),
    senderId,
    receiverId,
    traderId,
    content,
    timestamp: new Date().toISOString()
  };

  db.messages.push(newMsg);
  writeDB(db);

  res.json(newMsg);
});

// 10. Trader clients endpoint: List all clients subscribed to a specific trader
app.get('/api/traders/:id/clients', (req, res) => {
  const traderId = req.params.id;
  const db = readDB();

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
app.get('/api/plans', (req, res) => {
  const db = readDB();
  res.json(db.plans || []);
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
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const db = readDB();
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
app.post('/api/admin/mfa-verify', (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) {
    return res.status(400).json({ error: 'tempToken and MFA code are required.' });
  }

  const session = tempTokens.get(tempToken);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'MFA verification session expired or invalid.' });
  }

  const db = readDB();
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
app.get('/api/admin/dev-mfa', (req, res) => {
  const db = readDB();
  if (!db.admin) {
    return res.status(500).json({ error: 'Admin database not initialized.' });
  }
  const code = generateTOTP(db.admin.mfaSecret);
  res.json({ code });
});

// 13. Admin Endpoint: List all clients (omitting password hash)
app.get('/api/admin/users', verifyAdminToken, (req, res) => {
  const db = readDB();
  const safeClients = db.clients.map(({ password, ...rest }) => rest);
  res.json(safeClients);
});

// 14. Admin Endpoint: Toggle client suspension status
app.post('/api/admin/users/toggle-status', verifyAdminToken, (req, res) => {
  const { clientId } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required.' });
  }

  const db = readDB();
  const client = db.clients.find(c => c.id === clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client account not found.' });
  }

  client.status = (client.status === 'suspended') ? 'active' : 'suspended';
  writeDB(db);

  res.json({ success: true, status: client.status });
});

// 15. Admin Endpoint: Get payment history list
app.get('/api/admin/payments', verifyAdminToken, (req, res) => {
  const db = readDB();
  res.json(db.payments || []);
});

// 16. Admin Endpoint: List all traders (omitting passwords)
app.get('/api/admin/traders', verifyAdminToken, (req, res) => {
  const db = readDB();
  const safeTraders = db.traders.map(({ password, ...rest }) => rest);
  res.json(safeTraders);
});

// 17. Admin Endpoint: Create or edit trader account details
app.post('/api/admin/traders/save', verifyAdminToken, (req, res) => {
  const { id, name, strategy, roi, winRate, description, avatar, password } = req.body;
  if (!id || !name || !strategy || roi === undefined || winRate === undefined) {
    return res.status(400).json({ error: 'Required fields missing: id, name, strategy, roi, winRate.' });
  }

  const db = readDB();
  let trader = db.traders.find(t => t.id === id);

  if (trader) {
    // Edit existing trader
    trader.name = name;
    trader.strategy = strategy;
    trader.roi = parseFloat(roi);
    trader.winRate = parseFloat(winRate);
    trader.description = description || '';
    if (avatar) trader.avatar = avatar;
    if (password) trader.password = password;
  } else {
    // Create new trader
    trader = {
      id,
      name,
      strategy,
      roi: parseFloat(roi),
      winRate: parseFloat(winRate),
      subscribers: 0,
      rank: db.traders.length + 1,
      password: password || 'password123',
      avatar: avatar || 'https://lh3.googleusercontent.com/aida-public/AB6AXuA5eU9Y4jFzvTSMF0XOKV2Sa1gIbmi6EPjwiiKlBm68b5MOXG9uQAGhY35yzrTSQYERVpT6fm0Lfe1Jcmli5pIUcVn10kppVXPnOgH3N17fWPVElt_mSRdFetzhOdNb51XWFuAl8LfFzNe75_BrEB0N7vIBapvpvE_-SHt4kePGIpbnVxOBV2QE4C57rD7j4JMCKemBqq7XggVmtMJQsptK_25o3WCkJ_Jw51Il68DuCG47PKkOOUktcaUfDZDpNqfhokVVCURoWv8',
      description: description || ''
    };
    db.traders.push(trader);
  }

  // Sort and re-rank traders based on ROI descending
  db.traders.sort((a, b) => b.roi - a.roi);
  db.traders.forEach((t, i) => t.rank = i + 1);

  writeDB(db);
  res.json({ success: true, trader: { id: trader.id, name: trader.name } });
});

// 18. Admin Endpoint: Delete or toggle active status of a trader
app.post('/api/admin/traders/toggle-status', verifyAdminToken, (req, res) => {
  const { traderId, action } = req.body;
  if (!traderId) {
    return res.status(400).json({ error: 'traderId is required.' });
  }

  const db = readDB();
  const index = db.traders.findIndex(t => t.id === traderId);
  if (index === -1) {
    return res.status(404).json({ error: 'Trader account not found.' });
  }

  if (action === 'delete') {
    db.traders.splice(index, 1);
    // Sort and re-rank
    db.traders.sort((a, b) => b.roi - a.roi);
    db.traders.forEach((t, i) => t.rank = i + 1);
    writeDB(db);
    return res.json({ success: true, deleted: true });
  } else {
    const trader = db.traders[index];
    trader.status = (trader.status === 'suspended') ? 'active' : 'suspended';
    writeDB(db);
    return res.json({ success: true, status: trader.status });
  }
});

// 19. Admin Endpoint: Update subscription plans pricing and features list
app.post('/api/admin/plans/update', verifyAdminToken, (req, res) => {
  const { plans } = req.body;
  if (!plans || !Array.isArray(plans)) {
    return res.status(400).json({ error: 'Plans array is required.' });
  }

  const db = readDB();
  db.plans = plans;
  writeDB(db);

  res.json({ success: true, plans: db.plans });
});

// Fallback HTML router
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Saudaa Server is running on http://localhost:${PORT}`);
});
