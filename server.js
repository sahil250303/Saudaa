const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

// Security Headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Tailwind is now self-hosted — CDN script and inline tailwind.config removed.
      // 'unsafe-inline' added to scriptSrc to allow HTML onclick attributes to execute.
      scriptSrc: ["'self'", "'unsafe-inline'", "https://*.tradingview.com", "https://*.tradingview-widget.com", "https://checkout.razorpay.com", "https://cdn.razorpay.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      // 'unsafe-inline' kept for styleSrc only (Material Symbols uses inline font-face declarations)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "*.googleusercontent.com", "https://cdn.razorpay.com"],
      connectSrc: ["'self'", "https:"],
      frameSrc: ["'self'", "https://checkout.razorpay.com", "https://api.razorpay.com", "https://*.tradingview-widget.com", "https://*.tradingview.com"],
    },
  },
  // Disable X-Powered-By (already done by Helmet) and enable HSTS
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration-specific limiter — prevents account-creation spam
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many registration attempts from this IP. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many subscription attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ limit: '100kb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const {
  readDB,
  writeDB,
  getAdminSession,
  saveAdminSession,
  deleteAdminSession
} = require('./db.js');

// ── JWT Secret ────────────────────────────────────────────────────────────────
// SESSION_SECRET should be set as a Vercel environment variable.
// IMPORTANT: Never call process.exit() in a Vercel serverless function —
// it crashes the function container and returns 500 on every request.
// Instead we fall back to an ephemeral secret and log a loud warning.
let JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    console.error('[SECURITY] SESSION_SECRET is not set in environment variables! ' +
      'Auth tokens will not survive cold starts. ' +
      'Fix: add SESSION_SECRET in Vercel Dashboard → Settings → Environment Variables.');
  } else {
    console.warn('[SECURITY] SESSION_SECRET not set. Using ephemeral secret for local dev.');
  }
}

function checkEnvVars() {
  // SESSION_SECRET is critical — handled above.
  const recommended = ['SUPABASE_URL', 'SUPABASE_KEY', 'ALPHA_VANTAGE_API_KEY'];
  const missing = recommended.filter(k => !process.env[k]);
  if (missing.length) {
    console.warn('[CONFIG] Missing recommended environment variables:', missing.join(', '));
  }
}
checkEnvVars();

// ── Input Sanitization ────────────────────────────────────────────────────────
// Escape HTML special characters to prevent stored XSS via user-supplied strings.
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── CSRF: Origin / Referer validation for mutating admin routes ───────────────
function verifySameOrigin(req, res, next) {
  const origin  = req.headers['origin'];
  const referer = req.headers['referer'];
  const host    = req.headers['host'];
  const check   = origin || referer;
  if (check) {
    try {
      const url = new URL(check);
      if (url.host !== host) {
        return res.status(403).json({ error: 'CSRF check failed: cross-origin request rejected.' });
      }
    } catch {
      return res.status(403).json({ error: 'CSRF check failed: invalid origin header.' });
    }
  }
  next();
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
      mfaSecret: crypto.randomBytes(20).toString('hex'),
      jwtSecret: crypto.randomBytes(32).toString('hex')
    };
    updated = true;
    console.log('[INIT] Default admin account seeded.');
  } else if (!db.admin.jwtSecret) {
    db.admin.jwtSecret = crypto.randomBytes(32).toString('hex');
    updated = true;
    console.log('[INIT] Generated persistent jwtSecret for existing admin account.');
  }

  // JWT_SECRET is always sourced from the SESSION_SECRET env var (set above).
  // We do NOT fall back to db.admin.jwtSecret — that value may be committed to version control.

  // Seed traders if the DB has fewer than the expected full roster (11).
  // This handles a partial-seed state (e.g. Supabase was populated with only 1 trader).
  const EXPECTED_TRADER_COUNT = 11;
  if (!db.traders || db.traders.length < EXPECTED_TRADER_COUNT) {
    const salt = crypto.randomBytes(16).toString('hex');
    const defaultPassHash = crypto.scryptSync('password123', salt, 64).toString('hex');

    db.traders = [
      {
        id: "alex_pro",
        name: "Alex Pro",
        strategy: "Algorithmic & Swing",
        winRate: 82.9,
        roi: 68.5,
        subscribers: 0,
        rank: 1,
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200",
        description: "Professional quant trader specializing in index swing trading and high-frequency algorithms.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "neon_ghost",
        name: "Neon Ghost",
        strategy: "Scalping & Options",
        winRate: 78.4,
        roi: 59.2,
        subscribers: 0,
        rank: 2,
        avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200",
        description: "Derivative analyst focusing on Nifty/BankNifty weekly option writing and theta decay strategies.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "macro_bull",
        name: "Macro Bull",
        strategy: "Global Macro",
        winRate: 74.1,
        roi: 52.4,
        subscribers: 0,
        rank: 3,
        avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
        description: "Macro economist tracking interest rates, inflation, and global liquidity trends for gold and bond yields.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "alpha_scalp",
        name: "Alpha Scalp",
        strategy: "Intraday Momentum",
        winRate: 76.5,
        roi: 48.9,
        subscribers: 0,
        rank: 4,
        avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200",
        description: "Intraday momentum trader focusing on breakout stocks and order book flow analysis.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "delta_wanderer",
        name: "Delta Wanderer",
        strategy: "Arbitrage & Hedging",
        winRate: 85.0,
        roi: 42.1,
        subscribers: 0,
        rank: 5,
        avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=200",
        description: "Delta-neutral option strategist and cross-exchange crypto arbitrage specialist.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "satoshi_trader",
        name: "Satoshi Trader",
        strategy: "Crypto & DeFi",
        winRate: 69.2,
        roi: 45.8,
        subscribers: 0,
        rank: 6,
        avatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=200",
        description: "Blockchain analyst trading top-cap assets and liquid staking tokens.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "trend_rider",
        name: "Trend Rider",
        strategy: "Momentum Trend Follower",
        winRate: 68.4,
        roi: 39.5,
        subscribers: 0,
        rank: 7,
        avatar: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=200",
        description: "Medium-term trend follower utilizing moving averages and MACD breakout indicators.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "commodities_pro",
        name: "Commodities Pro",
        strategy: "Commodity Cycles",
        winRate: 72.3,
        roi: 36.8,
        subscribers: 0,
        rank: 8,
        avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=200",
        description: "Physical commodity trader predicting cycles in crude oil, natural gas, and copper.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "value_investor",
        name: "Value Investor",
        strategy: "Fundamental Value",
        winRate: 70.5,
        roi: 31.2,
        subscribers: 0,
        rank: 9,
        avatar: "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&q=80&w=200",
        description: "Discount cash flow modeling expert investing in undervalued mid-cap growth stocks.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "quantum_trade",
        name: "Quantum Trade",
        strategy: "Statistical Arbitrage",
        winRate: 88.5,
        roi: 29.8,
        subscribers: 0,
        rank: 10,
        avatar: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&q=80&w=200",
        description: "Quantitative researcher utilizing mean reversion and statistical arbitrage on pairs trading.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      },
      {
        id: "theta_gang",
        name: "Theta Gang",
        strategy: "Premium Selling",
        winRate: 81.2,
        roi: 28.5,
        subscribers: 0,
        rank: 11,
        avatar: "https://images.unsplash.com/photo-1489980508314-941910ded1f4?auto=format&fit=crop&q=80&w=200",
        description: "Structured options income strategies including iron condors, credit spreads, and covered calls.",
        status: "active",
        passwordHash: defaultPassHash,
        salt: salt
      }
    ];
    updated = true;
    console.log('[INIT] Seeding 11 professional traders...');
  }

  if (!db.plans || db.plans.length === 0) {
    db.plans = [
      { id: "standard", name: "Standard Plan", price: 59, features: ["General Community Access", "Standard Signals List"] },
      { id: "pro", name: "Pro Elite Plan", price: 99, features: ["1-on-1 Private Trader Chat", "Advanced Signals Feed"] },
      { id: "vip", name: "VIP Plan", price: 249, features: ["Access to 10 Trader Dashboards", "Option Hedging Insights"] }
    ];
    updated = true;
    console.log('[INIT] Default plans seeded.');
  }

  if (!db.payments || db.payments.length === 0) {
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

// Helper to generate a subscription premium ID
function generatePremiumID() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `SA-${num}-ELITE`;
}

// Live Market Stock Data Strip Configuration & Background Poller
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
if (!ALPHA_VANTAGE_API_KEY) {
  console.warn('[WARNING] ALPHA_VANTAGE_API_KEY not set. Market strip will use simulation only.');
}
const symbols = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN'];
let currentSymbolIndex = 0;
let apiRateLimited = !ALPHA_VANTAGE_API_KEY;

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

let dbInitialized = false;
let dbInitializationPromise = null;

async function ensureDbInitialized() {
  if (dbInitialized) return;
  if (!dbInitializationPromise) {
    dbInitializationPromise = (async () => {
      await initAdminDB();
      await migrateDatabasePasswords();
      dbInitialized = true;
    })();
  }
  await dbInitializationPromise;
}

// Middleware to ensure DB is initialized before handling requests
app.use(async (req, res, next) => {
  try {
    await ensureDbInitialized();
    next();
  } catch (error) {
    console.error('Database initialization failed:', error);
    res.status(500).json({ error: 'Internal Server Error: Database initialization failed.' });
  }
});

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
app.post('/api/auth/login', authLimiter, async (req, res) => {
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
app.post('/api/auth/register', registerLimiter, async (req, res) => {
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
app.post('/api/subscribe', subscribeLimiter, async (req, res) => {
  const { email, password, traderId, plan, paymentId, orderId, signature } = req.body;

  // Block sandbox bypass: require Razorpay in any production environment (Vercel or NODE_ENV=production)
  if (!razorpay && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
    return res.status(503).json({
      error: 'Payment processing is not configured. Contact support to complete your subscription.'
    });
  }

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
    // Enforce subscription expiry
    if (new Date(client.subscription.expiresAt) < new Date()) {
      return res.status(403).json({
        error: 'Your subscription has expired. Please renew to continue.',
        expired: true
      });
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
    asset:     sanitize(asset),
    type:      sanitize(type),
    entry:     sanitize(entry),
    target:    sanitize(target),
    stopLoss:  sanitize(stopLoss),
    risk:      sanitize(risk),
    assetType: sanitize(assetType || 'Stocks'),
    strategy:  sanitize(strategy || 'Day Trade'),
    notes:     sanitize(notes || ''),
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

  // Enforce message length limit (prevent payload flooding)
  if (content.length > 2000) {
    return res.status(400).json({ error: 'Message content exceeds the 2000 character limit.' });
  }

  const db = await readDB();
  const newMsg = {
    id: 'msg_' + Math.random().toString(36).substr(2, 9),
    senderId,
    receiverId,
    traderId,
    content: sanitize(content),
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
async function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  const token = authHeader.substring(7);
  const session = await getAdminSession(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Access denied. Invalid or expired session.' });
  }
  next();
}

// 11. Admin Login: Credentials verification
app.post('/api/admin/login', authLimiter, verifySameOrigin, async (req, res) => {
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

  // Credentials correct. Generate active admin session token directly
  const adminToken = 'adm_' + crypto.randomBytes(32).toString('hex');
  const adminExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); // 8 hours expiry
  await saveAdminSession(adminToken, adminExpiresAt);

  res.json({ success: true, adminToken });
});

// Admin Logout Endpoint
app.post('/api/admin/logout', verifyAdminToken, async (req, res) => {
  const token = req.headers['authorization']?.substring(7);
  if (token) {
    await deleteAdminSession(token);
  }
  res.json({ success: true });
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

    // Clean up suggestions and free signals of the deleted trader in memory to avoid foreign key violations on writeDB upsert
    db.suggestions = (db.suggestions || []).filter(s => s.traderId !== traderId);
    if (db.freeSignals) {
      db.freeSignals = db.freeSignals.filter(fs => fs.traderId !== traderId);
    }

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

// SPA router: serve index.html for known page routes, 404.html for everything else
app.get(/.*/, (req, res) => {
  const knownRoutes = ['/', '/dashboard.html', '/admin.html',
    '/legal/privacy.html', '/legal/terms.html', '/legal/risk.html', '/legal/refund.html'];
  const reqPath = req.path.replace(/\/$/, '') || '/';
  if (knownRoutes.includes(reqPath)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  // Static assets (css, js, png, etc.) are handled by express.static above — this is a 404
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Start Server
if (!process.env.VERCEL) {
  ensureDbInitialized().then(() => {
    app.listen(PORT, () => {
      console.log(`Saudaa Server is running on http://localhost:${PORT}`);
    });
  }).catch(error => {
    console.error('Failed to initialize database and start server:', error);
    process.exit(1);
  });
}

module.exports = app;

