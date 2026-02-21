# QA & Deployment Readiness Assessment

Date: 2026-02-21
Scope: Functional verification, integration assessment, UI/display review, bug identification, enhancements, and go-live readiness for the full app.

## Test Execution Summary

- `npm run typecheck` ❌ (blocking compile/type integrity issue)
- `npm run build` ❌ (same blocking issue propagates to production build)
- `npm run dev -- --host 0.0.0.0 --port 4173` ✅ (UI starts)
- Browser validation against local app ✅ (login screen rendered; configuration-error handling confirmed)

## Prioritized Findings (Bugs / Issues Only)

### P0 — Production build is blocked by TypeScript contract violation
**Area:** Functional verification / release stability  
**Evidence:** Type-check and build fail due to a required `FinancialData.notifications` field missing in `setData(...)` payload.

- `FinancialData` requires `notifications`.  
- `fetchData` state update object omits `notifications`.

**Repro steps**
1. Run `npm run typecheck`.
2. Observe TS2345 error in `context/DataContext.tsx` line 136 region.
3. Run `npm run build`; observe same failure.

**Impact:** Release cannot be built reliably; CI/CD gate should fail.

---

### P1 — Reset flow leaves investment-planning datasets behind (data-integrity risk)
**Area:** Integration assessment / data lifecycle  
**Evidence:** `_internalResetData` only deletes a subset of tables and excludes `investment_plan`, `portfolio_universe`, `status_change_log`, `execution_logs` (and no persisted notifications source is handled either).

**Repro steps**
1. Load or create investment plan and universe/log records.
2. Trigger reset (`resetData`).
3. Re-open plan/health views and observe residual plan/universe/log records can remain due to partial table cleanup.

**Impact:** “Reset/Clean slate” behavior is inconsistent; stale records can contaminate user state and downstream analytics.

---

### P2 — Notifications screen is non-persistent and can become stale after data changes
**Area:** Functional/UI behavior consistency  
**Evidence:** Notifications are generated in `useMemo`, then copied once into local state via `useState(allNotifications)`. Subsequent updates to `data.priceAlerts`, `data.plannedTrades`, or market prices do not refresh displayed notifications unless component remounts.

**Repro steps**
1. Open Notifications page.
2. Change underlying alert/trade trigger conditions (or receive market updates).
3. Observe list may not refresh because state is decoupled from recalculated `allNotifications`.

**Impact:** Users can miss newly triggered events; trust in alerting degrades.

---

### P2 — Environment dependency is hard-blocking for auth flows (operational readiness prerequisite)
**Area:** Integration / deployment configuration  
**Evidence:** When `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing, login/signup are intentionally disabled and a configuration error is shown.

**Repro steps**
1. Start app without Supabase env vars.
2. Open login/signup.
3. Observe “Configuration Error… Authentication is currently disabled.”

**Impact:** Expected behavior, but go-live requires verified env provisioning and secret management checks in deployment pipeline.

## Enhancement Recommendations (Actionable)

1. **Fix blocking type/build issue immediately**
   - Include `notifications` in `setData(...)` with safe fallback (`[]`) or make field optional only if truly non-required.
   - Add CI gate: `npm run typecheck && npm run build`.

2. **Harden reset/data lifecycle semantics**
   - Extend reset table list to all persisted domains (plan/universe/log tables and any notification persistence table).
   - Add a post-reset integrity check (single source of truth assertion).

3. **Make notifications reactive and durable**
   - Derive render list directly from memoized source, or sync local state through `useEffect` on `allNotifications` changes.
   - Optionally persist read/unread status server-side for cross-device consistency.

4. **Deployment readiness controls**
   - Add startup health diagnostics for required env vars (Supabase + Gemini key path).
   - Add pre-deploy checklist in CI/CD to prevent promotion when mandatory secrets are missing.

## Readiness Verdict

**Current status: NOT READY for production launch** due to a **P0 build-blocking defect** and **P1 data-reset integrity risk**.

**Minimum go-live exit criteria**
1. Typecheck/build pass cleanly.
2. Reset fully clears all persisted financial/investment planning domains.
3. Notifications refresh deterministically when triggers change.
4. Environment-variable validation enforced in deployment pipeline.
