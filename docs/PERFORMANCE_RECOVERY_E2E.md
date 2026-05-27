# Performance recovery — end-to-end verification

Release **2.1.1.0** performance work is “done” when **all three layers** pass.

## 1. Automated (local / CI)

```bash
npm run verify:performance-recovery
```

Runs:

- `tests/performanceRecoveryCoverage.vitest.test.ts` — wiring guards (statements, prefetch, cockpit, shell metrics provider, budgets, telemetry, stability rollout)
- `tests/budgetSpendFingerprint.vitest.test.ts`, `tests/quoteRefreshCooldown.vitest.test.ts`, `tests/pageActions.vitest.test.ts` (plan expense drill-down)
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
| Supabase migration | `supabase db push` or apply `20260527120000_fix_shared_budget_consumed_date_trim.sql`; Budgets → shared totals RPC **200** (no `btrim(date)` error) |
| Shared budgets | Top **Retry shared totals** banner + migration hint; 30s backoff; RPC retries once server-side |
| Plan spike | **Large expenses affecting this plan** panel + validation warning; drill-down to Transactions |
| Awaed / platform P/L | Platform **net_capital** P/L; holdings outlier banner per platform; corrupt `current_value` clamped to cost |
| Goals envelope | Page banner when budget + investment both linked — projected monthly = **budget only** |
| Quotes | Header refresh respects cooldown after 429; leaving Investments cancels in-flight quote batch |
| Investments | Platform cards use **net capital** P/L (Awaed vs deposits); Shift+click refresh forces fetch |
| Goals | Goal with linked budget shows projected monthly = **budget only** (not budget + plan) |
| Plan spike | Worst month/category link opens Transactions with `filter-plan-expense:YYYY:M:category` |
| Plan vs Dashboard | **Compare on Dashboard** → Dashboard KPI row + violet banner (Plan YTD from session vs NW / monthly P&amp;L) |
| Plan grid copy | **How planned columns work** + grid InfoHint explain income vs expense planned rules (not one merged number) |
| Quote proxies | Repeat SAHMK/Stooq requests within 15m on same warm function → `X-Quote-Cache: HIT` in response headers |
| Budgets panels | Budget Intelligence uses extracted RPC status + recurring bills panel; shared RPC retries once on failure |

Record results in [`rollout-signoff-performance-2.1.1.0.md`](./rollout-signoff-performance-2.1.1.0.md).

## Architecture (performance)

- **`CanonicalFinancialMetricsProvider`** in `AuthenticatedAppShell` computes headline + dashboard metrics **once per debounced quote tick**; pages read via `useCanonicalFinancialMetrics()` / `useDashboardCanonicalMetrics()`.
- **`useCanonicalSpotFx()`** on FX-only surfaces (Transactions, Watchlist, notifications, charts).
- **`useDebouncedMarketPrices()`** for Layout auto-snapshots and any surface outside the canonical hook that still needs quotes.
- **`useFinancialEnhancementInsights()`** runs on **`requestIdleCallback`** (skipped during `showHydrateBanner`) — Dashboard, Budgets, Plan, Wealth Ultra.
- **`useEnhancementSignals()`** skips during hydrate; shared fingerprint avoids full-data rescans.
- **Idle route prefetch** warms Budgets, Transactions, Investments, Plan, Goals, Analysis, Forecast, Zakat, Assets, Commodities, Market Events, Notifications after first paint.
- **`NetWorthCockpit`** on Dashboard/Summary uses `metricsOverride` so the chart does not trigger a second full bundle.

## 3. Regression spot-checks

- Upload / commit a statement → **one** explicit persist (not a storm on refresh).
- Change a holding in Market Simulator → no console spam; values update once.
- Toggle currency → headline NW and Dashboard KPI row stay aligned with Summary.
