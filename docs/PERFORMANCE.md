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
