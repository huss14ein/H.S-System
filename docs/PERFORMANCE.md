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

Preview deploy URLs (`https://<hash>--finova-hussein.netlify.app/`) **redirect to** the canonical host via an inline script in `index.html` and `enforceCanonicalHostRedirect()`. Lighthouse will flag that redirect and may skew metrics.

**Always run Lighthouse against:** `https://finova-hussein.netlify.app/` (see `VITE_CANONICAL_APP_URL` in `netlify.toml`).

## Login / unauthenticated shell

- **Critical CSS:** inline rules in `index.html` for first paint (system font, layout).
- **`auth-shell.css`:** small Tailwind build (`tailwind.auth.config.js`) for login, signup, and pending approval only — built to `public/auth-shell.css` on each `vite build` / dev server start.
- **Full `index.css`:** loaded only after the user passes approval and enters `AuthenticatedAppShell` (`utils/loadAppStyles.ts` + `AppStylesGate`).

## After login

The main bundle, Supabase client, and page chunks load as before; chart libraries stay in lazy route chunks (`vendor-recharts`, etc.).
