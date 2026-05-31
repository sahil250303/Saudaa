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

// Supabase config
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[DB] Supabase database client initialized successfully.');
  } catch (error) {
    console.error('[DB] Failed to initialize Supabase client:', error);
  }
} else {
  console.warn('[DB] Supabase credentials not found. Falling back to local file database.json.');
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
          edited: s.edited
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
          mfaSecret: admin.data[0].mfa_secret || admin.data[0].mfaSecret
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
          createdAt: fs.created_at || fs.createdAt
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
        edited: s.edited
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
        mfa_secret: data.admin.mfaSecret
      }] : [];

      const freeSignalsData = (data.freeSignals || []).map(fs => ({
        id: fs.id,
        trader_id: fs.traderId,
        trader_name: fs.traderName,
        description: fs.description,
        timing: fs.timing,
        created_at: fs.createdAt
      }));

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
      await Promise.all([
        suggestionsData.length ? supabase.from('suggestions').upsert(suggestionsData) : Promise.resolve(),
        clientsData.length ? supabase.from('clients').upsert(clientsData) : Promise.resolve(),
        messagesData.length ? supabase.from('messages').upsert(messagesData) : Promise.resolve(),
        paymentsData.length ? supabase.from('payments').upsert(paymentsData) : Promise.resolve(),
        adminData.length ? supabase.from('admin').upsert(adminData) : Promise.resolve(),
        freeSignalsData.length ? supabase.from('free_signals').upsert(freeSignalsData) : Promise.resolve()
      ]);

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

module.exports = { readDB, writeDB, isSupabase: () => !!supabase };
