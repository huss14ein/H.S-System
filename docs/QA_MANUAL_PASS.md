# Manual QA pass (before / after a release)

Use after `npm run test` (lint + typecheck + unit tests) and optionally `npm run test:e2e`.

## Automated

1. `npm run test` — must pass.
2. `npm run build` — must succeed.
3. `npm run test:e2e` — smoke load (Chromium); first time run `npx playwright install chromium`.

## Core flows (signed-in)

4. **Dashboard** — loads; KPIs not obviously blank if data exists; no console errors on first paint.
5. **Accounts** — list loads; add/edit path does not crash (optional).
6. **Transactions** — list/filter; add one tx (optional).
7. **Budgets** — page renders; derived / emergency copy if applicable.
8. **Summary** — net worth card; exports dropdown does not throw (optional).
9. **Investments** — hub tabs switch without blank screen.
10. **Settings** — Reports & export: wealth summary + monthly JSON if data exists.

## Cross-browser / device (spot check)

11. One mobile width (e.g. 390px): nav usable, no horizontal scroll on main pages.
12. Second browser or incognito: **localStorage-only** features (e.g. net worth snapshots) are per-browser.

## Deploy

13. Confirm **Netlify** build runs `npm run test && npm run build` (see `netlify.toml`).
14. After deploy: open prod URL, confirm **CSP** / headers do not block Supabase or fonts (check network tab if blank screen).

## Optional deep

15. **Supabase** — RLS: second user cannot read first user’s rows (if multi-user).
