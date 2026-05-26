# Performance recovery rollout sign-off (2.1.1.0)

| Field | Value |
|-------|--------|
| Date | _fill on deploy verify_ |
| Preview URL | _e.g. deploy-preview-NNN--…netlify.app_ |
| Tester | _name_ |

**Automated gate:** `npm run verify:performance-recovery`  
**Browser E2E:** `npm run test:e2e -- e2e/performance-recovery.spec.ts`  
**Manual preview:** [`PERFORMANCE_RECOVERY_E2E.md`](./PERFORMANCE_RECOVERY_E2E.md)

## Phase 1 — Stability

| Todo | Status | Evidence |
|------|--------|----------|
| phase1-statements | Done | Load-only hydrate; `statementPersistence.ts`; coverage test |
| phase1-datacontext | Done | `bindStableActions`; `showHydrateBanner` |
| phase1-market-context | Done | `MarketDataContext` memoized value |
| phase1-tests | Done | `statementProcessingPersist.vitest.test.ts` |

## Phase 2 — CPU / bundle

| Todo | Status | Evidence |
|------|--------|----------|
| phase2-notifications | Done | Split memos; debounced quotes; `useEnhancementSignals` |
| phase2-snapshot | Done | Throttle on Dashboard + Summary |
| phase2-market-datacontext | Done | No-op filters; FX epsilon; heal guard |
| phase2-canonical-dedupe | Done | `CanonicalFinancialMetricsProvider` in shell; Investments alias; spot FX pages |
| phase2-lazy-routes | Done | Dashboard eager; idle prefetch all primary routes |
| phase2-pages | Done | Cockpit `metricsOverride`; debounced prices |

## Phase 3 — Data sanity

| Todo | Status | Evidence |
|------|--------|----------|
| phase3-data-audit | Done | ROI sanitize; holdings audit UI + SQL script |
| phase3-kpi-telemetry | Done | `logKpiReconciliationDrift` + quality panel |

## Phase 4 — Product

| Todo | Status | Evidence |
|------|--------|----------|
| phase4-next-month-budget | Done | RPC, CTA, palette, card footnotes |
| phase4-month-open | Done | Month-open banner + tests |
| phase4-perf-optional | Done | Budget card pagination (`BUDGET_CARDS_PAGE_SIZE`) |
| phase4-product-automation | Done | Drift rows clickable on Budgets; enhancement strip |

## Phase 5 — E2E

| Check | Pass |
|-------|------|
| `npm run verify:performance-recovery` | |
| `npm run test` green | |
| Playwright primary routes + 0 statement writes | |
| Preview: navigation &lt; 3s | |
| Preview: KPI plausible | |
| Preview: budget advance + month-open | |
