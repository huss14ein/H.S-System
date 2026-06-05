# AI proxy (Executive Summary / gemini-proxy)

Production uses same-host `/api/gemini-proxy` with CORS that **always allows the browser origin when it matches the request `Host`** (no manual `ALLOWED_ORIGINS` required for `finova-hussein.netlify.app`).

If **AI summary is off** after deploy:

1. Hard-refresh the app (or clear site data) so you are not on an old JS bundle.
2. Netlify → **Environment variables** → add **`GEMINI_API_KEY`** (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) with scope **Functions** or **All**.
3. **Trigger deploy** → Dashboard → **Retry connection check**.

`netlify.toml` also sets `ALLOWED_ORIGINS` and `FINOVA_CANONICAL_APP_URL` for function runtime.

---

# Performance (Lighthouse / Core Web Vitals)

## Auditing the production URL

Preview deploy URLs (`https://<hash>--finova-hussein.netlify.app/`) **redirect to** the canonical Netlify host for real users (inline script + `enforceCanonicalHostRedirect()`). **Lighthouse / Chrome-Lighthouse** user agents skip that redirect so Netlify deploy audits are not flagged. **Vercel** (`https://h-s-system.vercel.app`) is a first-class mirror and is **not** redirected.

**Lighthouse (Netlify deploy plugin):** audits **`https://finova-hussein.netlify.app`** directly (`netlify.toml` → `@netlify/plugin-lighthouse`). Do not use deploy preview URLs (`<hash>--finova-hussein.netlify.app`) — they redirect to canonical production and Lighthouse will warn that the test URL was redirected.

Manual checks: `https://finova-hussein.netlify.app/` or `https://h-s-system.vercel.app/` (Vercel mirror).

## Login / unauthenticated shell

- **Critical CSS:** inline rules in `index.html` for first paint (system font, layout).
- **`auth-shell.css`:** small Tailwind build (`tailwind.auth.config.js`) for login, signup, and pending approval only — built to `public/auth-shell.css` on each `vite build` / dev server start. Loaded via **non-blocking** `rel=preload` + `onload` stylesheet swap.
- **Auth pages:** `LoginPage`, `SignupPage`, and `PendingApprovalPage` are **lazy** — not in the entry chunk.
- **Full `index.css`:** loaded only after the user passes approval and enters `AuthenticatedAppShell` (`utils/loadAppStyles.ts` + lazy `AppStylesGate`).
- **Charts (`vendor-recharts`):** only in lazy route chunks after login — not on the login Lighthouse path when the latest build is deployed.

Run `npm run verify:login-performance` after changes to this path.

## After login

The main bundle, Supabase client, and page chunks load as before; chart libraries stay in lazy route chunks (`vendor-recharts`, etc.).
