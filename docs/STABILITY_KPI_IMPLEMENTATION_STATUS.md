# Stability & KPI plan — what is done vs still open

Reference: stability plan (May 2026). Automated gate: `npm run verify:performance-recovery` (last run: **pass**, 627 tests).

**Implementation todos:** all plan items are **completed in code** on this branch. Remaining rows below are **ops / data / preview** only.

## Done in code (this branch)

| Area | What shipped |
|------|----------------|
| Shared budget RPC | Migration `20260527120000_fix_shared_budget_consumed_date_trim.sql`; app banner + 30s backoff; single RPC attempt |
| Platform P/L | `net_capital` on platform cards; tests updated |
| Goals | Budget-first envelope; UI + AI + conflict engine aligned |
| Quotes | Cooldown, 15/tick + queue, cache on normal refresh, partial live, yield before holding persist |
| KPI perf | 1500ms debounce on full canonical metrics; spot FX immediate |
| Budgets | Spend fingerprint; recurring/advanced deferred; household autopilot deferred until expand |
| Nav | Cancel quotes leaving Investments; idle prefetch includes Budgets |
| Notifications | Core vs price-triggered split; data fingerprints |
| Plan | `sarPerUsd` only; Plan vs Dashboard comparison card; spike drill-down; column-mismatch section; `plan-compare-dashboard` → Dashboard KPI row + session compare banner |
| Budgets panels | `BudgetSharedRpcBanner` (retry) + `BudgetSharedRpcStatusLine`, `BudgetRecurringBillsPanel`; `sharedBudgetConsumedRpc` (single retry) |
| Plan spike | `detectPlanExpenseOutliers` + `PlanExpenseSpikePanel` → Transactions `filter-plan-expense` |
| Investments | `InvestmentsQuoteStatusBanner`; per-platform `PlatformHoldingsOutlierBanner`; `holdingValuation` clamps corrupt notionals |
| Goals UX | `GoalsFundingEnvelopeBanner` when budget + investment both linked (envelope = budget only) |
| Quote edge cache | `netlify/functions/quoteEdgeCache.ts` on SAHMK + Stooq proxies (15m in-process) |
| System perf | Idle enhancement insights; debounced quotes on Summary/Wealth Ultra/Investments/Layout; expanded idle prefetch; no duplicate Budgets hydrate banner |
| Header monthly plan | Same math as Investments hub (`computeMonthlyInvestmentPlanProgress`) |

## Still requires you (cannot finish in git)

| Item | Why it feels “missing” |
|------|-------------------------|
| Apply Supabase migration | RPC fix is in repo only until `supabase db push` / SQL editor |
| Plan −451k spike | Needs outlier transaction identified/removed in **your** data |
| Holdings audit | Run `scripts/sql/audit-holdings-value-outliers.sql` in Supabase; fix rows |
| Netlify env keys | Live quotes stay SIMULATED without SAHMK/Finnhub |
| Preview smoke | [`PERFORMANCE_RECOVERY_E2E.md`](./PERFORMANCE_RECOVERY_E2E.md) — navigation &lt;3s, RPC green, KPI sanity |
| Sign-off doc | Fill pass/fail in [`rollout-signoff-performance-2.1.1.0.md`](./rollout-signoff-performance-2.1.1.0.md) |

## Still not shipped (by design)

- **Redis / cross-instance quote cache** — warm Netlify functions only; client `quotePriceCache` + throttle remain.
- **One merged Plan YTD = Dashboard net worth** — comparison card + `PlanCompareContextBanner` show both; Plan → “What we still do not merge”.
- **Full `Budgets.tsx` route split** — intelligence panels extracted; main page file unchanged for household/modals.
- List virtualization everywhere

## End-to-end verification matrix (re-run after deploy)

| Check | Command / action | Expected |
|-------|------------------|----------|
| TypeScript | `npm run typecheck` | Exit 0 |
| Unit + wiring | `npm run verify:performance-recovery` | 611+ tests, wiring includes stability rollout block |
| Shared budget RPC | Supabase: apply `20260527120000_…_date_trim.sql` | Budgets Network: RPC 200, no `btrim(date)` |
| Goals envelope | Goal with budget 11k + plan 6k | Projected monthly = 11k only |
| Awaed / platform P/L | Investments → platform card | Unrealized P/L ≈ value − (invested − withdrawn) |
| Quotes | Normal refresh (no Shift) | Uses cache; no tab freeze |
| Quotes hard refresh | Shift+click refresh in header | `forceFetch` live pull |
| Header monthly % | Compare to Investments → Plan summary | Same target (per-portfolio sum) |
| Plan spike | Plan → worst month → Transactions | Filter applied |
| Household engine | Budgets → Household tab | Projections load only after expanding autopilot |
| Live quotes | Netlify env | Not stuck on SIMULATED when keys set |

## If something still feels wrong after deploy

1. **Budgets red RPC** → migration not applied.
2. **SIMULATED prices** → API keys / rate limit; Shift+click for hard refresh.
3. **Header monthly % vs Investments** → should now match; hard refresh if old bundle cached.
4. **Plan spike** → use “View expenses in Transactions” on Plan; delete/fix the huge expense row.
5. **Awaed P/L** → confirm card shows net deposits basis; holdings rows still use lot cost.
