-- SUPABASE SCHEMA FOR SAUDAA SUGGESTIONS PLATFORM
-- Paste this script directly into the Supabase SQL Editor to configure your database.

-- 1. Create Traders Table
CREATE TABLE IF NOT EXISTS traders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strategy TEXT,
  win_rate NUMERIC DEFAULT 0,
  roi NUMERIC DEFAULT 0,
  subscribers INTEGER DEFAULT 0,
  rank INTEGER DEFAULT 99,
  password_hash TEXT,
  salt TEXT,
  avatar TEXT,
  description TEXT,
  status TEXT DEFAULT 'active'
);

-- 2. Create Suggestions Table
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  trader_id TEXT REFERENCES traders(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  type TEXT NOT NULL,
  entry TEXT NOT NULL,
  target TEXT NOT NULL,
  stop_loss TEXT NOT NULL,
  risk TEXT,
  asset_type TEXT DEFAULT 'Stocks',
  strategy TEXT DEFAULT 'Day Trade',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  edited BOOLEAN DEFAULT FALSE
);

-- 3. Create Clients Table
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  sub_id TEXT,
  subscription JSONB,
  status TEXT DEFAULT 'active'
);

-- 4. Create Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  trader_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create Admin Table
CREATE TABLE IF NOT EXISTS admin (
  username TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  mfa_secret TEXT
);

-- 6. Create Plans Table
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  features JSONB
);

-- 7. Create Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  sub_id TEXT,
  trader_id TEXT NOT NULL,
  trader_name TEXT,
  plan TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT NOT NULL
);

-- Enable Row Level Security (RLS) policies or leave disabled for public client connection
-- (By default, Supabase tables restrict direct anonymous access if RLS is on.
--  Since our node server connects via the service_role key, it bypasses RLS).
ALTER TABLE traders DISABLE ROW LEVEL SECURITY;
ALTER TABLE suggestions DISABLE ROW LEVEL SECURITY;
ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin DISABLE ROW LEVEL SECURITY;
ALTER TABLE plans DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;

-- 8. Create Free Signals Table
CREATE TABLE IF NOT EXISTS free_signals (
  id TEXT PRIMARY KEY,
  trader_id TEXT REFERENCES traders(id) ON DELETE CASCADE,
  trader_name TEXT,
  description TEXT NOT NULL,
  timing TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE free_signals DISABLE ROW LEVEL SECURITY;

-- Indexes for performance queries
CREATE INDEX IF NOT EXISTS idx_suggestions_trader_id ON suggestions(trader_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_flow ON messages(trader_id, sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_payments_email ON payments(email);
CREATE INDEX IF NOT EXISTS idx_free_signals_trader_id ON free_signals(trader_id);
