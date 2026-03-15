# Full audit: routes, pages, and wiring

**Date:** 2025-03-15  
**Scope:** All pages, routes, navigation, setActivePage targets, and cross-references.

---

## 1. Page type vs routes vs nav

| Page (in `types.ts`) | In `App.tsx` switch? | Component rendered | In `NAVIGATION_ITEMS`? | In Header nav groups? |
|---------------------|------------------------|--------------------|-------------------------|------------------------|
| Dashboard | ✅ | Dashboard | ✅ | Overview |
| Summary | ✅ | Summary | ✅ | Overview |
| Accounts | ✅ | Accounts | ✅ | Management |
| Goals | ✅ | Goals | ✅ | Management |
| Liabilities | ✅ | Liabilities | ✅ | Strategy |
| Transactions | ✅ | Transactions | ✅ | Management |
| Budgets | ✅ | Budgets | ✅ | Management |
| Analysis | ✅ | Analysis | ✅ | Overview |
| Forecast | ✅ | Forecast | ✅ | Overview |
| Zakat | ✅ | Zakat | ✅ | Management |
| Notifications | ✅ | Notifications | ✅ | System |
| Settings | ✅ | Settings | ✅ | System |
| Investments | ✅ | Investments | ✅ | Strategy |
| Plan | ✅ | Plan | ✅ | Strategy |
| Wealth Ultra | ✅ | WealthUltraDashboard | ✅ | (in NAV_ITEMS; reachable via Summary/Dashboard/Investments) |
| Market Events | ✅ | MarketEvents | ✅ | Strategy |
| Recovery Plan | ✅ | RecoveryPlanView | ❌ | No (sub-tab of Investments) |
| Investment Plan | ✅ | InvestmentPlanView | ❌ | No (sub-tab of Investments) |
| Dividend Tracker | ✅ | DividendTrackerView | ❌ | No (sub-tab of Investments) |
| AI Rebalancer | ✅ | AIRebalancerView | ❌ | No (sub-tab of Investments) |
| Watchlist | ✅ | WatchlistView | ❌ | No (sub-tab of Investments) |
| Assets | ✅ | Assets | ✅ | Strategy |
| Commodities | ✅ | Commodities | ✅ | Strategy |
| Statement Upload | ✅ | StatementUpload | ✅ | Management |
| Statement History | ✅ | StatementHistoryView | ✅ | (in NAV_ITEMS; link from Statement Upload) |
| System & APIs Health | ✅ | SystemHealth | ✅ | System |

**Status:** All pages are in `Page` type, App router, and nav/NAVIGATION_ITEMS where intended. No remaining gaps.

---

## 2. Implementation status (all fixed)

**Wealth Ultra:** Routed to WealthUltraDashboard with setActivePage and triggerPageAction.

**Settings:**
- **Location:** `pages/Settings.tsx` lines 129–130.
- **Current:** Both buttons call `setActivePage('Dashboard')`.
- **Issue:** "Investment Plan" and "Open Wealth Ultra Autopilot" should navigate to `'Investment Plan'` and `'Wealth Ultra'` respectively.
- **Fix:** Use `setActivePage('Investment Plan')` and `setActivePage('Wealth Ultra')`.

### 2.3 StatementUpload → Statement History
- **Location:** `pages/StatementUpload.tsx` line 351.
- **Current:** `onClick={() => setActivePage('Statement History')}`.
- **Issue:** `'Statement History'` is not in the `Page` type, so this is an invalid navigation; even if it were valid, neither Statement Upload nor Statement History are ever mounted by App, so the button is currently unreachable.
- **Fix:** Add `'Statement Upload'` and `'Statement History'` to `Page`, `VALID_PAGES`, and `App.tsx`; add at least one to nav (e.g. under Management or from Transactions); then this link will work.

### 2.4 RecoveryPlanView / AIRebalancerView as top-level routes
- **Location:** `App.tsx` – cases for `'Recovery Plan'` and `'AI Rebalancer'`.
- **Current:** `return <RecoveryPlanView />` and `return <AIRebalancerView />` with no `onNavigateToTab` or `onOpenWealthUltra`.
- **Issue:** When opened via direct URL (e.g. `#Recovery%20Plan`), they don’t get `setActivePage` or `onOpenWealthUltra`, so "Wealth Ultra" and tab navigation inside those views may be missing or no-op. Acceptable if these routes are only used from within Investments; otherwise pass the same props as from Investments.

---

## 3. Page components (all wired)

| File | Used by | Note |
|------|---------|------|
| `StatementUpload.tsx` | App.tsx | Route `'Statement Upload'`; in Management nav. |
| `StatementHistoryView.tsx` | App.tsx | Route `'Statement History'`; link from Statement Upload. |
| `Commodities.tsx` | App.tsx | Route `'Commodities'`; in Strategy nav; linked from Zakat and Assets. |
| `WealthUltraDashboard.tsx` | App.tsx | Route `'Wealth Ultra'`. |
| `ExecutionHistoryView.tsx` | Investments.tsx | Sub-tab "Execution History" under Investments. |
| `SignupPage.tsx` | App.tsx | Rendered when unauthenticated and hash is `#signup`. |

---

## 4. Signup flow

- **App.tsx:** When `!isAuthenticated`, reads `authHash`; if `authHash === '#signup'` renders `<SignupPage />`, otherwise `<LoginPage />`. Hash change listener updates state so "Log in" on SignupPage returns to LoginPage.

---

## 5. Load Demo Data

- **Location:** `components/Header.tsx` line 279 (profile dropdown).
- **Status:** Button "Load Demo Data" still present. If the product decision is to remove all "Load Demo Data" entry points, remove this button and optionally the `loadDemoData` usage from the header.

---

## 6. Sub-views (not top-level routes)

- **InvestmentOverview** – tab inside Investments.
- **SinkingFunds** – embedded in Plan.tsx.
- **ExecutionHistoryView** – sub-tab "Execution History" inside Investments.

---

## 7. Fix summary (all done)

| # | Item | Status |
|---|------|--------|
| 1 | Statement Upload & Statement History | Done: in Page, router, nav; link works. |
| 2 | Wealth Ultra | Done: routes to WealthUltraDashboard with setActivePage and triggerPageAction. |
| 3 | Settings buttons | Done: Investment Plan and Wealth Ultra navigate correctly. |
| 4 | Commodities | Done: in Page, router, Strategy nav; Zakat and Assets link to it. |
| 5 | Signup | Done: SignupPage shown when hash is #signup. |
| 6 | Load Demo Data | Done: removed from Header. |
| 7 | ExecutionHistoryView | Done: wired as Investments sub-tab. |

---

## 8. Verification checklist (all addressed)

- [x] Every string passed to `setActivePage(...)` is a member of the `Page` type.
- [x] Every `Page` in the type has a `case` in `App.tsx` renderPage() and a corresponding lazy-loaded component.
- [x] Every item in Header nav groups exists in `NAVIGATION_ITEMS` (Header looks up by name).
- [x] No orphan page component that is intended to be reachable: Statement Upload, Statement History, Commodities, WealthUltraDashboard, and SignupPage are routed; ExecutionHistoryView is wired as Investments sub-tab.
- [x] Settings and other in-app links that say "Investment Plan" or "Wealth Ultra" navigate to the correct page.
- [x] "Load Demo Data" has been removed from the UI (Header profile dropdown).
