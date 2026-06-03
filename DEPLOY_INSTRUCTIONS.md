# Saudaa — Deployment Instructions
## Run these steps in order to go live securely

---

## STEP 1 — Set Environment Variables in Vercel (do this FIRST)

Open: https://vercel.com/sahilreghate20-4427s-projects/saudaa/settings/environment-variables

Add each of the following as **Production + Preview + Development** environment variables:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | `7c977e33cb896ffa631f2c01bcb2ffd483f934d2226cb6c7e373965cef4f62603bdd6b07bfc69554c4164f53d7ff81da` |
| `SUPABASE_URL` | `https://zjdzokigjliszvfrmaqi.supabase.co` |
| `SUPABASE_KEY` | *(your service_role key from .env — starts with eyJhbGci…)* |
| `ALPHA_VANTAGE_API_KEY` | *(your Alpha Vantage key, or leave blank for simulated mode)* |

> ⚠️ Keep SESSION_SECRET secret. Never commit it to the repo.

---

## STEP 2 — Run these git commands in your terminal (from D:\Workspace\saudaa)

```bash
# Remove sensitive files from git tracking (they stay on disk, just not in git)
git rm --cached database.json
git rm --cached response.html
git rm --cached inspect_console.js
git rm --cached inspect_preloader.js
git rm --cached verify_redesign_final.js 2>/dev/null || true
git rm --cached verify_all_views.js 2>/dev/null || true
git rm --cached verify_system_security.js 2>/dev/null || true

# Stage all the fixed/new files
git add .gitignore
git add server.js
git add db.js
git add public/index.html
git add public/app.js
git add public/robots.txt
git add public/sitemap.xml

# Commit everything
git commit -m "fix: security hardening, Supabase integration, SEO, db.js

- Remove database.json / debug scripts from git tracking
- server.js: remove unsafe-eval from CSP, fix JWT_SECRET (env-only),
  add registerLimiter, CSRF origin check, input sanitization,
  tighten body limit to 100kb, block sandbox payments in prod
- db.js: use service-role key only (remove NEXT_PUBLIC fallback),
  add auth:persistSession=false, hard-fail warning in production
- index.html: full SEO meta, OG, Twitter Card, Schema.org,
  canonical URL, favicon, simulated-data badge, canvas aria-hidden
- app.js: show/hide simulated market badge from API response
- Add public/robots.txt and public/sitemap.xml
- Supabase: enable RLS on admin_sessions, add performance indexes"

# Push — Vercel auto-deploys on push to main
git push origin main
```

---

## STEP 3 — After deployment, verify the fix

1. Visit https://saudaa.vercel.app — the site should load (no more blank page)
2. Visit https://saudaa.vercel.app/robots.txt — should show your robots file
3. Visit https://saudaa.vercel.app/sitemap.xml — should show the sitemap
4. Check Vercel logs: https://vercel.com/sahilreghate20-4427s-projects/saudaa/deployments
   - Look for `[DB] Supabase client initialized (service role).`
   - There should be NO `[FATAL]` lines

---

## STEP 4 — Purge the old git history (important for PII removal)

The database.json (with user emails + hashes) was committed in earlier pushes.
To fully erase it from git history, run **after** the deployment is confirmed working:

```bash
# Install git-filter-repo if not present
pip install git-filter-repo

# Remove database.json from ALL past commits
git filter-repo --path database.json --invert-paths --force
git filter-repo --path response.html --invert-paths --force

# Force push the cleaned history
git push origin main --force
```

> After this, the old commits will no longer contain the leaked data.
> Note: this rewrites history — if anyone else has cloned the repo, they need to re-clone.

---

## STEP 5 — Change your admin password

Since the old admin credentials were public, set a new strong password
via the Supabase SQL editor:

```sql
-- Replace 'YOUR_NEW_PASSWORD' with a strong password
DO $$
DECLARE
  new_salt TEXT := encode(gen_random_bytes(16), 'hex');
  new_hash TEXT;
BEGIN
  -- Note: Supabase uses pgcrypto, not scrypt. Run this via your Node app instead.
  -- Better: use the /api/admin/login endpoint after deployment, then change via admin panel.
END $$;
```

The easiest way is: after deployment, log into the admin panel and use the
"Edit Trader / Admin" flow to update the password — which uses your server's
scrypt hashing correctly.

---

## Summary of what was fixed in this deployment

| Area | Fix |
|---|---|
| 🔴 Blank site | db.js added to repo — server now starts correctly |
| 🔴 JWT Secret | No longer falls back to database value; hard-fails in production if missing |
| 🔴 unsafe-eval CSP | Removed from Content Security Policy |
| 🔴 Sandbox bypass | Payment gateway now blocks unauthenticated orders in production |
| 🟠 Register spam | Rate limiter added (5 registrations/IP/hour) |
| 🟠 CSRF | Origin header check on admin login |
| 🟠 XSS | Input sanitization on all user-supplied signals, notes, and chat messages |
| 🟠 Body flood | Request body limit tightened from 10 MB → 100 KB |
| 🟠 Supabase key | Server only uses service_role key, never publishable key |
| 🟠 RLS | admin_sessions table now has RLS enabled |
| 🟡 SEO | Title, description, OG tags, Twitter Card, Schema.org, canonical, favicon |
| 🟡 Sitemap | /sitemap.xml created |
| 🟡 Robots.txt | /robots.txt created (blocks /admin, /api) |
| 🟡 Simulated data | Badge shown to users when market data is not live |
| 🟡 Accessibility | canvas aria-hidden, simulated badge aria-live |
