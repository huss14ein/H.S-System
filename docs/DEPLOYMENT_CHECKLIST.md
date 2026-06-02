# Production Deployment Checklist

**Version:** 1.2.0.0  
**Last updated:** March 2026

This checklist ensures all critical items are configured before going live.

---

## Pre-Deployment

### 1. Environment Variables

#### Supabase Project
- [ ] `GEMINI_API_KEY` (or backup keys: `ANTHROPIC_API_KEY`, `GROK_API_KEY`, `OPENAI_API_KEY`)
- [ ] `SUPABASE_URL` (auto-set)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (for Edge Functions)
- [ ] `WEEKLY_DIGEST_SECRET` (random secret for email function auth)
- [ ] `RESEND_API_KEY` or `SENDGRID_API_KEY` (for weekly emails)
- [ ] `EMAIL_FROM` (e.g., `noreply@yourdomain.com`)

#### Netlify Project
- [ ] `VITE_SUPABASE_URL`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `VITE_ALLOW_SIGNUP` (set to `"true"` if signup should be enabled)
- [ ] `GEMINI_API_KEY` (primary)
- [ ] `GEMINI_API_KEY_BACKUP` (optional)
- [ ] `ANTHROPIC_API_KEY` (optional, for rotation)
- [ ] `GROK_API_KEY` (optional, for rotation)
- [ ] `OPENAI_API_KEY` (optional, for rotation)

**Important:** Do NOT set `VITE_GEMINI_API_KEY` in production. It's for local dev only.

---

### 2. Database Migrations

**Option A — single file (recommended):** After base tables exist, run:

- [ ] `supabase/UNIFIED_PRODUCTION_DB_SETUP.sql` (schema extensions + recurring + `budget_category` + RLS)

**Option B — granular:** Run in Supabase SQL editor in order:

1. [ ] `supabase/run_these_for_app.sql` (settings / budgets columns)
2. [ ] `supabase/full_schema_for_app.sql` (investment tables, execution logs, …)
3. [ ] `supabase/add_recurring_transactions.sql` and `add_recurring_add_manually.sql`
4. [ ] `supabase/ensure_transactions_budget_category.sql`
5. [ ] `supabase/rls_all_user_tables.sql` (RLS for production security)

Then add any optional migrations per `supabase/README_DB_MIGRATIONS.md`.

---

### 3. Supabase Edge Functions

Deploy Edge Functions:

- [ ] `supabase/functions/gemini-proxy` (AI proxy)
- [ ] `supabase/functions/send-weekly-digest` (weekly emails)

**Deploy command:**
```bash
supabase functions deploy gemini-proxy
supabase functions deploy send-weekly-digest
```

---

### 4. Weekly Email Setup (Optional)

If enabling weekly emails:

1. [ ] Set `RESEND_API_KEY` or `SENDGRID_API_KEY` in Supabase secrets
2. [ ] Set `EMAIL_FROM` in Supabase secrets
3. [ ] Set `WEEKLY_DIGEST_SECRET` in Supabase secrets (random string)
4. [ ] Schedule weekly cron job:
   - **Option A:** External cron (cron-job.org, GitHub Actions) that POSTs to:
     ```
     https://YOUR_PROJECT.supabase.co/functions/v1/send-weekly-digest
     ```
     With header: `x-weekly-digest-secret: YOUR_SECRET`
   - **Option B:** Supabase pg_cron (if available):
     ```sql
     SELECT cron.schedule(
       'weekly-digest',
       '0 9 * * 0', -- Every Sunday at 9 AM
       $$
       SELECT net.http_post(
         url := 'https://YOUR_PROJECT.supabase.co/functions/v1/send-weekly-digest',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'x-weekly-digest-secret', 'YOUR_SECRET'
         )
       );
       $$
     );
     ```

---

### 5. Security Configuration

- [ ] **RLS enabled** on all user-scoped tables (`rls_all_user_tables.sql` applied)
- [ ] **Security headers** configured in `netlify.toml` (already added)
- [ ] **CORS** configured correctly (Supabase Edge Functions)
- [ ] **API keys** stored as secrets (not in code or client env vars)

---

### 6. Build & Test

- [ ] `npm ci` (clean install)
- [ ] `npm run test` (lint + typecheck)
- [ ] `npm run build` (production build succeeds)
- [ ] `npm run preview` (local preview works)

---

### 7. Netlify Deployment

- [ ] Connect repository to Netlify
- [ ] Set build command: `npm ci && npm run test && npm run build`
- [ ] Set publish directory: `dist`
- [ ] Configure all environment variables (see section 1)
- [ ] Deploy and verify:
  - [ ] App loads without errors
  - [ ] Login/signup works
  - [ ] Data loads correctly
  - [ ] AI features work (test a summary or categorization)

---

### 8. Post-Deployment Verification

- [ ] **Authentication:** Sign up, login, logout work
- [ ] **Data CRUD:** Create/edit/delete accounts, transactions, budgets, goals
- [ ] **Transactions schema compatibility:** Run `supabase/verify_transactions_schema_compat.sql` and confirm required columns + pending RPC health
- [ ] **AI features:** Dashboard summary, transaction categorization, persona generation
- [ ] **Calculations:** Net worth, budget tracking, goal progress accurate
- [ ] **Security:** RLS prevents cross-user data access (test with two accounts)
- [ ] **Performance:** Pages load in < 3s, no console errors
- [ ] **Mobile:** Test on mobile device or responsive mode

---

### 9. Monitoring & Alerts

- [ ] Set up error tracking (e.g., Sentry, Netlify Functions logs)
- [ ] Monitor Supabase Edge Function logs
- [ ] Set up uptime monitoring (e.g., UptimeRobot)
- [ ] Configure email alerts for critical errors

---

### 10. Documentation

- [ ] Update `README.md` with deployment instructions
- [ ] Document environment variables in `.env.example`
- [ ] Create runbook for common issues

---

## Rollback Plan

If deployment fails:

1. **Netlify:** Use "Deploy settings" → "Deploy log" → "Rollback to previous deploy"
2. **Database:** Keep migration scripts versioned; rollback by running previous schema
3. **Edge Functions:** Redeploy previous version from git history

---

## Support & Troubleshooting

- **Merged to main but UI unchanged:** Open **Settings → App build** and compare the commit sha to GitHub `main`. If the sha is old, hard-refresh or use the **Refresh now** banner. **Wealth Analytics** lives under **Overview → Wealth Analytics** (hash `#Wealth%20Analytics`). If the nav item is missing, you are on a stale bundle or wrong host. Use **https://h-s-system.vercel.app** (Vercel mirror) or **https://finova-hussein.netlify.app** once Netlify is linked to this repo (`NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` in GitHub secrets). Do **not** use **my-finova.netlify.app** — that is a legacy Next.js app.
- **Build fails:** Check `netlify.toml` and environment variables
- **RLS errors:** Verify `rls_all_user_tables.sql` was applied
- **AI not working:** Keys live in **Netlify → Environment variables** (`GEMINI_API_KEY`, etc.) for **Functions** scope — not in the browser bundle. Health check: `POST /api/gemini-proxy` with body `{"health":true}`. After deploy, CI runs the same probe **with an `Origin` header** (see `.github/workflows/deploy-production.yml`). If Executive Summary shows “AI summary is off” with HTTP 403, redeploy **latest `main`** (must include `corsAllowlist` same-host + health bypass). Manual check:
  ```bash
  ORIGIN="https://YOUR-SITE.netlify.app"
  curl -sf -X POST "$ORIGIN/api/gemini-proxy" \
    -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
    -d '{"health":true}' | grep anyProviderConfigured
  ```
  `finova-hussein.netlify.app` must serve the app (not 404) — confirm Netlify site is linked to this repo and production branch is `main`. Branch `149` fixes ahead of an old `main` merge will not apply until merged and redeployed.
- **Weekly emails not sending:** Check Edge Function logs, verify cron job, test function manually with curl

---

## Quick Test Commands

```bash
# Test weekly digest function (replace with your values)
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/send-weekly-digest \
  -H "x-weekly-digest-secret: YOUR_SECRET" \
  -H "Content-Type: application/json"

# Test AI proxy health
curl https://YOUR_PROJECT.supabase.co/functions/v1/gemini-proxy \
  -H "Content-Type: application/json" \
  -d '{"health": true}'
```

---

**Status:** ✅ Ready for deployment after completing checklist items.
