/**
 * Saudaa — Image Upload Integration Tests
 */

process.env.SESSION_SECRET = 'test-secret-saudaa-ci';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');
const { readDB, writeDB } = require('../db');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '../database.json');
let dbBackup = null;

// Helper to generate JWT token for testing
function generateTestToken(userId, role) {
  const secret = process.env.SESSION_SECRET;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    id: userId,
    email: userId + '@test.com',
    role: role,
    exp: Date.now() + 24 * 60 * 60 * 1000
  };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
                          .update(`${base64Header}.${base64Payload}`)
                          .digest('base64url');
  return `${base64Header}.${base64Payload}.${signature}`;
}

describe('Image Upload Feature API Integration Tests', () => {
  const testTraderId = 'trader_test_1';
  let token;

  beforeAll(async () => {
    // 1. Backup local JSON database
    if (fs.existsSync(DB_PATH)) {
      dbBackup = fs.readFileSync(DB_PATH, 'utf8');
    }

    // 2. Load DB and seed a test trader
    const db = await readDB();
    db.traders = db.traders || [];
    db.traders = db.traders.filter(t => t.id !== testTraderId);
    db.traders.push({
      id: testTraderId,
      name: 'Test Trader',
      strategy: 'Scalp',
      winRate: 85,
      roi: 24.5,
      subscribers: 10,
      rank: 2,
      password: 'password',
      avatar: 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
      description: 'Test Bio',
      status: 'active'
    });
    await writeDB(db);

    // 3. Generate token
    token = generateTestToken(testTraderId, 'trader');
  });

  afterAll(async () => {
    // Restore backup
    if (dbBackup !== null) {
      fs.writeFileSync(DB_PATH, dbBackup, 'utf8');
    }
  });

  const validPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const invalidTextBase64 = 'data:text/plain;base64,aGVsbG8gd29ybGQ=';
  const tooLargeBase64 = 'data:image/png;base64,' + 'A'.repeat(2250000); // Exceeds 2.2 million characters (~1.5MB)

  describe('POST /api/suggestions with image uploads', () => {
    it('accepts valid suggestions with a valid chart image', async () => {
      const res = await request(app)
        .post('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          traderId: testTraderId,
          asset: 'INFY',
          type: 'Buy',
          entry: '1400 - 1410',
          target: '1480',
          stopLoss: '1370',
          risk: 'Medium',
          notes: 'Test analysis',
          image: validPngBase64
        });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.signal.image).toBe(validPngBase64);
    });

    it('rejects suggestions with invalid image format', async () => {
      const res = await request(app)
        .post('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          traderId: testTraderId,
          asset: 'INFY',
          type: 'Buy',
          entry: '1400 - 1410',
          target: '1480',
          stopLoss: '1370',
          risk: 'Medium',
          notes: 'Test analysis',
          image: invalidTextBase64
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid image format');
    });

    it('rejects suggestions with too large image size (>1.5MB)', async () => {
      const res = await request(app)
        .post('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          traderId: testTraderId,
          asset: 'INFY',
          type: 'Buy',
          entry: '1400 - 1410',
          target: '1480',
          stopLoss: '1370',
          risk: 'Medium',
          notes: 'Test analysis',
          image: tooLargeBase64
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Image size exceeds');
    });
  });

  describe('POST /api/free-signals with image uploads', () => {
    beforeEach(async () => {
      // Clear free signals count today to bypass 3-signal daily limit
      const db = await readDB();
      db.freeSignals = [];
      await writeDB(db);
    });

    it('accepts free signals with a valid chart image', async () => {
      const res = await request(app)
        .post('/api/free-signals')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'NIFTY complimentary analysis',
          timing: 'Immediate',
          image: validPngBase64
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.signal.image).toBe(validPngBase64);
    });

    it('rejects free signals with invalid image format', async () => {
      const res = await request(app)
        .post('/api/free-signals')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'NIFTY complimentary analysis',
          timing: 'Immediate',
          image: invalidTextBase64
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid image format');
    });

    it('rejects free signals with too large image size (>1.5MB)', async () => {
      const res = await request(app)
        .post('/api/free-signals')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'NIFTY complimentary analysis',
          timing: 'Immediate',
          image: tooLargeBase64
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Image size exceeds');
    });
  });
});
