/**
 * Saudaa API — Integration Tests
 *
 * These tests hit the real Express routes. They run against a local
 * in-memory / JSON-file database (Supabase is not mocked so set
 * SUPABASE_URL and SUPABASE_KEY in CI secrets if you want full coverage).
 *
 * Run: npm test
 */

process.env.SESSION_SECRET = 'test-secret-saudaa-ci';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server');

// ── Public Routes ─────────────────────────────────────────────────────────────

describe('GET /api/traders', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/api/traders');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('does not expose passwordHash or salt', async () => {
    const res = await request(app).get('/api/traders');
    res.body.forEach(trader => {
      expect(trader.passwordHash).toBeUndefined();
      expect(trader.password).toBeUndefined();
      expect(trader.salt).toBeUndefined();
    });
  });
});

describe('GET /api/plans', () => {
  it('returns subscription plans', async () => {
    const res = await request(app).get('/api/plans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/market-strip', () => {
  it('returns stock data object', async () => {
    const res = await request(app).get('/api/market-strip');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('source');
  });

  it('sets no-cache headers', async () => {
    const res = await request(app).get('/api/market-strip');
    expect(res.headers['cache-control']).toMatch(/no-store/i);
  });
});

describe('GET /api/free-signals', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/api/free-signals');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Auth Routes ───────────────────────────────────────────────────────────────

describe('POST /api/auth/login — validation', () => {
  it('returns 400 when credentials missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 for invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: 'nobody@nowhere.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/register — validation', () => {
  it('returns 400 when email or password missing', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: '' });
    expect(res.status).toBe(400);
  });
});

// ── Protected Routes ──────────────────────────────────────────────────────────

describe('GET /api/suggestions — auth required', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/suggestions?role=client&userId=x');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/chat/messages — auth required', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/chat/messages?clientId=a&traderId=b');
    expect(res.status).toBe(401);
  });
});

// ── Admin Routes ──────────────────────────────────────────────────────────────

describe('GET /api/admin/users — auth required', () => {
  it('returns 401 without admin token', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/login — validation', () => {
  it('returns 400 when credentials missing', async () => {
    const res = await request(app).post('/api/admin/login').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for wrong admin credentials', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'definitelywrong' })
      .set('origin', 'http://localhost:3000')
      .set('host', 'localhost:3000');
    expect([401, 500]).toContain(res.status);
  });
});

// ── Static Pages ──────────────────────────────────────────────────────────────

describe('Static pages', () => {
  it('GET / returns HTML with Saudaa title', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('Saudaa');
  });

  it('GET /robots.txt returns robots file', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('User-agent');
  });

  it('GET /sitemap.xml returns XML', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
  });

  it('GET /nonexistent returns 404', async () => {
    const res = await request(app).get('/this-page-does-not-exist');
    expect(res.status).toBe(404);
  });
});

// ── Security Headers ──────────────────────────────────────────────────────────

describe('Security headers', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not expose X-Powered-By', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets Content-Security-Policy', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
