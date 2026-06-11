const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DB_PATH = path.join(__dirname, 'database.json');

// Load environment variables from .env file if it exists (zero-dependency parser)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index > 0) {
        const key = trimmed.substring(0, index).trim();
        let val = trimmed.substring(index + 1).trim();
        // Remove surrounding quotes if present
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    });
  } catch (err) {
    console.error('[DB] Failed to load .env file:', err);
  }
}

// ── Supabase config ───────────────────────────────────────────────────────────
// Only SUPABASE_URL + SUPABASE_KEY (service role key) are accepted here.
// NEXT_PUBLIC_* keys are intentionally excluded: they are public/publishable keys
// with limited permissions and must never be used for server-side DB writes.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey && process.env.NODE_ENV !== 'test') {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,   // Server-side: no session persistence needed
        autoRefreshToken: false,
      }
    });
    console.log('[DB] Supabase client initialized (service role).');
  } catch (error) {
    console.error('[DB] Failed to initialize Supabase client:', error);
  }
} else {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    console.error('[FATAL] SUPABASE_URL and SUPABASE_KEY must be set in production. Falling back to read-only JSON (writes will fail).');
  } else if (process.env.NODE_ENV === 'test') {
    console.log('[DB] Test environment detected. Using local database.json (Supabase disabled).');
  } else {
    console.warn('[DB] Supabase credentials not found. Falling back to local file database.json.');
  }
}

async function readDB() {
  if (supabase) {
    try {
      const [traders, suggestions, clients, messages, admin, plans, payments, freeSignals] = await Promise.all([
        supabase.from('traders').select('*'),
        supabase.from('suggestions').select('*').order('created_at', { ascending: false }),
        supabase.from('clients').select('*'),
        supabase.from('messages').select('*'),
        supabase.from('admin').select('*'),
        supabase.from('plans').select('*'),
        supabase.from('payments').select('*'),
        supabase.from('free_signals').select('*').order('created_at', { ascending: false })
      ]);

      // Handle query errors
      if (traders.error) console.error('Supabase query error [traders]:', traders.error);
      if (suggestions.error) console.error('Supabase query error [suggestions]:', suggestions.error);
      if (clients.error) console.error('Supabase query error [clients]:', clients.error);
      if (messages.error) console.error('Supabase query error [messages]:', messages.error);
      if (admin.error) console.error('Supabase query error [admin]:', admin.error);
      if (plans.error) console.error('Supabase query error [plans]:', plans.error);
      if (payments.error) console.error('Supabase query error [payments]:', payments.error);
      if (freeSignals.error) console.error('Supabase query error [freeSignals]:', freeSignals.error);

      // Return mapping in correct camelCase properties compatible with existing endpoints
      return {
        traders: (traders.data || []).map(t => ({
          id: t.id,
          name: t.name,
          strategy: t.strategy,
          winRate: parseFloat(t.win_rate || t.winRate || 0),
          roi: parseFloat(t.roi || 0),
          subscribers: parseInt(t.subscribers || 0),
          rank: parseInt(t.rank || 0),
          passwordHash: t.password_hash || t.passwordHash,
          salt: t.salt,
          avatar: t.avatar,
          description: t.description,
          status: t.status || 'active'
        })),
        suggestions: (suggestions.data || []).map(s => ({
          id: s.id,
          traderId: s.trader_id || s.traderId,
          asset: s.asset,
          type: s.type,
          entry: s.entry,
          target: s.target,
          stopLoss: s.stop_loss || s.stopLoss,
          risk: s.risk,
          assetType: s.asset_type || s.assetType,
          strategy: s.strategy,
          notes: s.notes,
          createdAt: s.created_at || s.createdAt,
          edited: s.edited,
          image: s.image
        })),
        clients: (clients.data || []).map(c => ({
          id: c.id,
          email: c.email,
          passwordHash: c.password_hash || c.passwordHash,
          salt: c.salt,
          subId: c.sub_id || c.subId,
          subscription: c.subscription,
          status: c.status || 'active'
        })),
        messages: (messages.data || []).map(m => ({
          id: m.id,
          senderId: m.sender_id || m.senderId,
          receiverId: m.receiver_id || m.receiverId,
          traderId: m.trader_id || m.traderId,
          content: m.content,
          timestamp: m.timestamp
        })),
        admin: (admin.data && admin.data[0]) ? {
          username: admin.data[0].username,
          salt: admin.data[0].salt,
          passwordHash: admin.data[0].password_hash || admin.data[0].passwordHash,
          mfaSecret: admin.data[0].mfa_secret || admin.data[0].mfaSecret,
          jwtSecret: admin.data[0].jwt_secret || admin.data[0].jwtSecret
        } : null,
        plans: (plans.data || []).map(p => ({
          id: p.id,
          name: p.name,
          price: parseFloat(p.price || 0),
          features: p.features
        })),
        payments: (payments.data || []).map(p => ({
          id: p.id,
          email: p.email,
          subId: p.sub_id || p.subId,
          traderId: p.trader_id || p.traderId,
          traderName: p.trader_name || p.traderName,
          plan: p.plan,
          amount: parseFloat(p.amount || 0),
          timestamp: p.timestamp,
          status: p.status
        })),
        freeSignals: (freeSignals.data || []).map(fs => ({
          id: fs.id,
          traderId: fs.trader_id || fs.traderId,
          traderName: fs.trader_name || fs.traderName,
          description: fs.description,
          timing: fs.timing,
          createdAt: fs.created_at || fs.createdAt,
          image: fs.image
        }))
      };
    } catch (err) {
      console.error('[DB] Supabase read failed, falling back to local JSON schema:', err);
      // Fall through to local read
    }
  }

  // Local JSON File Database Fallback
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    if (!parsed.freeSignals) parsed.freeSignals = [];
    return parsed;
  } catch (error) {
    console.error('[DB] Local database.json read failed:', error);
    return { traders: [], suggestions: [], clients: [], messages: [], plans: [], payments: [], freeSignals: [] };
  }
}

async function writeDB(data) {
  if (supabase) {
    try {
      // Map structures to match Supabase database column schemas
      const tradersData = (data.traders || []).map(t => ({
        id: t.id,
        name: t.name,
        strategy: t.strategy,
        win_rate: t.winRate,
        roi: t.roi,
        subscribers: t.subscribers,
        rank: t.rank,
        password_hash: t.passwordHash,
        salt: t.salt,
        avatar: t.avatar,
        description: t.description,
        status: t.status
      }));

      const suggestionsData = (data.suggestions || []).map(s => ({
        id: s.id,
        trader_id: s.traderId,
        asset: s.asset,
        type: s.type,
        entry: s.entry,
        target: s.target,
        stop_loss: s.stopLoss,
        risk: s.risk,
        asset_type: s.assetType,
        strategy: s.strategy,
        notes: s.notes,
        created_at: s.createdAt,
        edited: s.edited,
        image: s.image
      }));

      const clientsData = (data.clients || []).map(c => ({
        id: c.id,
        email: c.email,
        password_hash: c.passwordHash,
        salt: c.salt,
        sub_id: c.subId,
        subscription: c.subscription,
        status: c.status || 'active'
      }));

      const messagesData = (data.messages || []).map(m => ({
        id: m.id,
        sender_id: m.senderId,
        receiver_id: m.receiverId,
        trader_id: m.traderId,
        content: m.content,
        timestamp: m.timestamp
      }));

      const plansData = (data.plans || []).map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        features: p.features
      }));

      const paymentsData = (data.payments || []).map(p => ({
        id: p.id,
        email: p.email,
        sub_id: p.subId,
        trader_id: p.traderId,
        trader_name: p.traderName,
        plan: p.plan,
        amount: p.amount,
        timestamp: p.timestamp,
        status: p.status
      }));

      const adminData = data.admin ? [{
        username: data.admin.username,
        salt: data.admin.salt,
        password_hash: data.admin.passwordHash,
        mfa_secret: data.admin.mfaSecret,
        jwt_secret: data.admin.jwtSecret
      }] : [];

      const freeSignalsData = (data.freeSignals || []).map(fs => ({
        id: fs.id,
        trader_id: fs.traderId,
        trader_name: fs.traderName,
        description: fs.description,
        timing: fs.timing,
        created_at: fs.createdAt,
        image: fs.image
      }));

      // Delete functions are handled explicitly via toggle-status/delete routes to prevent database corruption/race conditions

      // Write parent tables (traders, plans) sequentially first to prevent foreign-key race conditions in parallel execution
      if (tradersData.length) {
        const { error } = await supabase.from('traders').upsert(tradersData);
        if (error) throw error;
      }
      if (plansData.length) {
        const { error } = await supabase.from('plans').upsert(plansData);
        if (error) throw error;
      }

      // Parallelize writes for other non-dependent or child tables
      const results = await Promise.all([
        suggestionsData.length ? supabase.from('suggestions').upsert(suggestionsData) : Promise.resolve({ error: null }),
        clientsData.length ? supabase.from('clients').upsert(clientsData) : Promise.resolve({ error: null }),
        messagesData.length ? supabase.from('messages').upsert(messagesData) : Promise.resolve({ error: null }),
        paymentsData.length ? supabase.from('payments').upsert(paymentsData) : Promise.resolve({ error: null }),
        adminData.length ? supabase.from('admin').upsert(adminData) : Promise.resolve({ error: null }),
        freeSignalsData.length ? supabase.from('free_signals').upsert(freeSignalsData) : Promise.resolve({ error: null })
      ]);

      for (const res of results) {
        if (res.error) throw res.error;
      }

      return;
    } catch (err) {
      console.error('[DB] Supabase write failed, falling back to local database.json write:', err);
      // Fall through to local write
    }
  }

  // Local JSON File Database Fallback
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[DB] Local database.json write failed:', error);
  }
}

// Session store helper functions
async function getAdminSession(token) {
  if (supabase) {
    const { data, error } = await supabase
      .from('admin_sessions')
      .select('expires_at')
      .eq('token', token)
      .single();
    if (error || !data) return null;
    return data;
  } else {
    const db = await readDB();
    if (!db.admin_sessions) db.admin_sessions = {};
    const session = db.admin_sessions[token];
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      delete db.admin_sessions[token];
      await writeDB(db);
      return null;
    }
    return session;
  }
}

async function saveAdminSession(token, expiresAt) {
  if (supabase) {
    const { error } = await supabase
      .from('admin_sessions')
      .upsert({ token, expires_at: expiresAt });
    if (error) console.error('Error saving admin session to Supabase:', error);
  } else {
    const db = await readDB();
    if (!db.admin_sessions) db.admin_sessions = {};
    db.admin_sessions[token] = { token, expires_at: expiresAt };
    await writeDB(db);
  }
}

async function deleteAdminSession(token) {
  if (supabase) {
    const { error } = await supabase
      .from('admin_sessions')
      .delete()
      .eq('token', token);
    if (error) console.error('Error deleting admin session from Supabase:', error);
  } else {
    const db = await readDB();
    if (db.admin_sessions && db.admin_sessions[token]) {
      delete db.admin_sessions[token];
      await writeDB(db);
    }
  }
}

async function deleteTrader(traderId) {
  if (supabase) {
    try {
      const { error } = await supabase.from('traders').delete().eq('id', traderId);
      if (error) throw error;
      console.log(`[DB] Deleted trader account ${traderId} from Supabase.`);
    } catch (err) {
      console.error(`[DB] Error deleting trader ${traderId} from Supabase:`, err);
    }
  }
}

async function deleteSuggestion(suggestionId) {
  if (supabase) {
    try {
      const { error } = await supabase.from('suggestions').delete().eq('id', suggestionId);
      if (error) throw error;
      console.log(`[DB] Deleted suggestion ${suggestionId} from Supabase.`);
    } catch (err) {
      console.error(`[DB] Error deleting suggestion ${suggestionId} from Supabase:`, err);
    }
  }
}

module.exports = {
  readDB,
  writeDB,
  isSupabase: () => !!supabase,
  getAdminSession,
  saveAdminSession,
  deleteAdminSession,
  deleteTrader,
  deleteSuggestion
};
