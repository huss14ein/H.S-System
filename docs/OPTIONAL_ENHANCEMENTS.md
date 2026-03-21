# Optional Enhancements (Implemented & Reference)

This document describes optional improvements that have been added **without changing core behavior** of existing pages and flows.

---

## 1. DX – Environment Types

- **Done:** `VITE_ALLOW_SIGNUP` added to `env.d.ts` so TypeScript recognizes it. No runtime change; sign-up behavior is unchanged and still gated by the env value.

---

## 2. Responsive & Touch Targets

- **Done:**
  - **Utilities in `index.css`:**
    - `.touch-target`: `min-height: 44px; min-width: 44px` for mobile-friendly tap targets.
    - `.table-responsive`: `overflow-x: auto` and `-webkit-overflow-scrolling: touch` for horizontal scroll on small screens.
  - **Header:** Nav group buttons, currency selector, profile button, mobile menu button, and refresh button use `min-h-[44px]` / `min-w-[44px]` or `touch-target` where appropriate. Layout and behavior are unchanged; only tap area and a11y are improved.

- **Optional (per-page):** Add `table-responsive` to any `<div>` wrapping a `<table>` that might overflow on narrow viewports. Existing tables work as before without this class.

---

## 3. Accessibility (A11y)

- **Done (Header):**
  - Nav group: `aria-label="Open {Group} menu"`, `aria-expanded`.
  - Currency: `aria-label="Select currency"`, `aria-haspopup="listbox"`, `aria-expanded`.
  - Profile: `aria-label="Open profile menu"`, `aria-haspopup="menu"`, `aria-expanded`.
  - Mobile menu: `aria-label="Open navigation menu"`.
  - Refresh prices: `aria-label` (in addition to existing `title`).
  - Notifications button already had `aria-label`.
  - Icon-only buttons use `type="button"` where missing.

- **Optional:** Add `aria-label` to other icon-only buttons across the app; use status badge colors that meet contrast guidelines (e.g. WCAG AA) where you introduce new badges.

---

## 4. Performance

- **Existing:** `App.tsx` already lazy-loads page components via `React.lazy()` and wraps them in `Suspense`. No change needed for route-level code splitting.

- **Optional:** For very long lists (e.g. hundreds of transactions or goals), consider a virtualized list component (e.g. `react-window` or `@tanstack/react-virtual`) only on the pages that need it. Current pages do not use virtualization, so this is additive and opt-in per page.

---

## 5. Security

- **Env audit (reference):**
  - `VITE_*` variables are exposed to the client bundle. Do not put secrets there; use them only for non-sensitive config (e.g. feature flags, public API base URLs).
  - Supabase: use `VITE_SUPABASE_ANON_KEY` (public anon key). Row Level Security (RLS) enforces server-side access control; see `services/supabase/rls_all_user_tables.sql` and `supabase/README_DB_MIGRATIONS.md`.

- **Rate limiting:** Not implemented in the app. If you add sensitive or costly operations (e.g. AI calls, export, password reset), consider:
  - Supabase Edge Functions or your backend to enforce rate limits.
  - Or a client-side throttle for non-critical UX (e.g. “Refresh prices”) only; server-side limits remain required for security.

- **PII in AI:** Prompts in `geminiService` send transaction descriptions, amounts, and goal/budget summaries. Ensure your Gemini API and data handling comply with your privacy policy. No code change was made here; this is a policy/ops note.

---

## 6. Engines (Guardrails)

- **Existing behavior unchanged:**
  - `advancedRiskScoring`: `PortfolioRiskInput` already supports `maxPositionSize` and `maxSectorExposure`; callers can pass these to cap concentration.
  - `engineIntegration.validateInvestmentAction`: Uses `context.risk.maxPositionConcentration` and cash constraints; no change to logic.

- **Optional:** When building UI that calls these engines, pass conservative defaults (e.g. `maxPositionSize: 0.25`, `maxSectorExposure: 0.30`) so guardrails are applied without changing the engine APIs or existing call sites that do not pass them.

---

## Summary

| Area        | Change type | Impact on core |
|------------|-------------|----------------|
| DX         | Env type    | None           |
| Responsive | CSS + Header sizes | None; same layout and behavior |
| A11y       | Header aria + type="button" | None |
| Performance| Doc only (lazy already in use) | None |
| Security   | Doc only    | None           |
| Engines    | Doc only (APIs already support guardrails) | None |

All changes are additive or documentation-only so that existing functions and pages continue to behave as before.

---

## 7. Product backlog (completed)

| Item | What was done |
|------|----------------|
| Execution log validation | `validateExecutionLog` in `services/dataQuality/validation.ts`; wired in `saveExecutionLog` (DataContext). |
| Collapsible sections | Budgets (requests, household, admin, shared), Forecast (assumptions, chart, scenarios, goals, timeline), Investments (plan health, error boundary), Wealth Ultra (all dashboard `SectionCard`s). Assets / Notifications / Statement History already had collapsible where applicable. |
| Self-learning (Summary) | `trackAction('generate-financial-persona', 'Summary')` on AI persona generation. Other pages: `Layout` + `useTrackPageVisit(activePage)` already records visits for all main routes. |
