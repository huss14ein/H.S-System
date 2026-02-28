# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Finova is an AI-assisted personal wealth management SPA built with React 18, Vite 5, TypeScript, and Tailwind CSS. It uses Supabase (hosted PostgreSQL + Auth) as its backend and Google Gemini for AI features.

### Running the dev server

```
npm run dev
```

Vite serves on port 5173 by default. Use `--host 0.0.0.0` to expose on all interfaces.

### Lint / type-check

```
npm run lint        # runs tsc --noEmit
npm run typecheck   # same command
```

**Note:** There are pre-existing TS errors in `pages/Accounts.tsx`, `pages/Budgets.tsx`, and `pages/SystemHealth.tsx` (unused variables, type mismatches). These do not block the dev server but will fail `tsc --noEmit` and `npm run build` (which runs `tsc && vite build`).

### Build

```
npm run build    # tsc && vite build — currently fails due to pre-existing TS errors
```

### Required environment variables

The app requires Supabase credentials to function beyond the config-error screen. Without them, the login page displays a "Configuration Error" and the app cannot be used. Create a `.env.local` file (or set env vars) with:

- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anonymous/public key

Optional for AI features:
- `VITE_GEMINI_API_KEY` — Google Gemini API key (dev-only shortcut)

Optional for market data:
- `VITE_FINNHUB_API_KEY` — Finnhub API key

### No automated test suite

This project has no test framework or test files configured. There is no `npm test` command.

### Project structure

- Single-page React app (not a monorepo)
- `components/` — reusable UI components
- `pages/` — page-level components (~30 pages)
- `context/` — React context providers (Auth, Data, Currency, MarketData, AI)
- `services/` — Supabase client, Gemini AI service
- `data/` — mock/seed data
- `netlify/functions/` — serverless proxy for Gemini API in production
- `supabase/functions/` — Supabase Edge Function alternative proxy
