# Performance recovery — end-to-end verification

Release **2.1.1.0** performance work is “done” when **all three layers** pass.

## 1. Automated (local / CI)

```bash
npm run verify:performance-recovery
```

Runs:

- `tests/performanceRecoveryCoverage.vitest.test.ts` — wiring guards (statements, prefetch, cockpit, shell metrics provider, budgets, telemetry)
- `tests/pageLoadingGateCoverage.vitest.test.ts` — no full-page hydrate spinners
- `tests/statementProcessingPersist.vitest.test.ts`
- `tests/netWorthSnapshotThrottle.vitest.test.ts`
- Full `vitest run`

Browser (signed-in session recommended):

```bash
npm run test:e2e -- e2e/performance-recovery.spec.ts
```

## 2. Deploy preview (signed in)

| Step | Pass criteria |
|------|----------------|
| Dashboard load | Network tab: **0** `financial_statements` **writes** (POST/PATCH/upsert) on first load |
| Navigation | `#Dashboard` → `#Budgets` → `#Transactions` → `#Summary` each show `#main-content` in **&lt; 3s** |
| KPI sanity | Net worth and investment ROI are plausible (no trillion-SAR spikes) |
| Budgets Monthly | “Next month available” when headroom exists; **Borrow from next month** at ≥90% util; month-open banner in first week |
| Command palette | “Borrow from next month (Budgets)” opens request form |

Record results in [`rollout-signoff-performance-2.1.1.0.md`](./rollout-signoff-performance-2.1.1.0.md).

## Architecture (performance)

- **`CanonicalFinancialMetricsProvider`** in `AuthenticatedAppShell` computes headline + dashboard metrics **once per debounced quote tick**; pages read via `useCanonicalFinancialMetrics()` / `useDashboardCanonicalMetrics()`.
- **`useCanonicalSpotFx()`** on FX-only surfaces (Transactions, Watchlist, notifications, charts).
- **`NetWorthCockpit`** on Dashboard/Summary uses `metricsOverride` so the chart does not trigger a second full bundle.

## 3. Regression spot-checks

- Upload / commit a statement → **one** explicit persist (not a storm on refresh).
- Change a holding in Market Simulator → no console spam; values update once.
- Toggle currency → headline NW and Dashboard KPI row stay aligned with Summary.
