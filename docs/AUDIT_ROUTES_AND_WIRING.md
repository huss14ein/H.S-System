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
| Wealth Ultra | ✅ | **InvestmentPlanView** (wrong) | ✅ | (via nav: Strategy → not listed; in NAV_ITEMS) |
| Market Events | ✅ | MarketEvents | ✅ | Strategy |
| Recovery Plan | ✅ | RecoveryPlanView | ❌ | No (sub-tab of Investments) |
| Investment Plan | ✅ | InvestmentPlanView | ❌ | No (sub-tab of Investments) |
| Dividend Tracker | ✅ | DividendTrackerView | ❌ | No (sub-tab of Investments) |
| AI Rebalancer | ✅ | AIRebalancerView | ❌ | No (sub-tab of Investments) |
| Watchlist | ✅ | WatchlistView | ❌ | No (sub-tab of Investments) |
| Assets | ✅ | Assets | ✅ | Strategy |
| System & APIs Health | ✅ | SystemHealth | ✅ | System |

**Gaps:**
- **Statement Upload** – not in `Page` type, not in App, not in nav. Component exists (`StatementUpload.tsx`).
- **Statement History** – not in `Page` type, not in App, not in nav. Component exists (`StatementHistoryView.tsx`). Referenced from `StatementUpload.tsx` via `setActivePage('Statement History')` (invalid Page).
- **Commodities** – not in `Page` type, not in App, not in nav. Component exists (`Commodities.tsx`). Zakat.tsx copy says "change … on the 'Investments' and 'Commodities' pages" but there is no Commodities route.

---

## 2. Wrong or inconsistent implementation

### 2.1 Wealth Ultra route shows wrong component
- **Location:** `App.tsx` line 157.
- **Current:** `case 'Wealth Ultra': return <InvestmentPlanView onExecutePlan={() => {}} />; // Temporary mapping`
- **Issue:** `WealthUltraDashboard.tsx` is the real Wealth Ultra UI (allocation, orders, export). It is never used as a top-level route. Users clicking "Wealth Ultra" in nav or from Summary/Dashboard/Investments see Investment Plan instead.
- **Fix:** Route `'Wealth Ultra'` to `WealthUltraDashboard` and pass `setActivePage` and `triggerPageAction` (component expects these).

### 2.2 Settings: wrong targets for Investment Plan / Wealth Ultra
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

## 3. Orphan / unreachable page components

| File | Used by | Note |
|------|---------|------|
| `StatementUpload.tsx` | Nothing | Never imported in App; no route. |
| `StatementHistoryView.tsx` | Nothing | Never imported in App; no route. |
| `Commodities.tsx` | Nothing | Never imported in App; no route. Zakat mentions "Commodities" page. |
| `WealthUltraDashboard.tsx` | Nothing (as route) | Used only by reference; App uses InvestmentPlanView for "Wealth Ultra". |
| `ExecutionHistoryView.tsx` | Nothing | Never imported anywhere. Orphan. |
| `SignupPage.tsx` | Nothing | Never imported in App. LoginPage links to `#signup` but App never renders SignupPage. |

---

## 4. Signup flow

- **LoginPage.tsx:** When `VITE_ALLOW_SIGNUP === 'true'`, shows "Sign up" with `href="#signup"`.
- **App.tsx:** When `!isAuthenticated`, always renders `<LoginPage />`. Hash is not read; there is no `#signup` → SignupPage handling.
- **Result:** Clicking "Sign up" only changes the URL to `#signup`; the screen stays LoginPage. SignupPage is never shown.
- **Fix (optional):** In the unauthenticated branch, if `window.location.hash === '#signup'` (or similar), render `<SignupPage />` instead of (or alongside) LoginPage; or handle signup inside LoginPage and remove SignupPage.

---

## 5. Load Demo Data

- **Location:** `components/Header.tsx` line 279 (profile dropdown).
- **Status:** Button "Load Demo Data" still present. If the product decision is to remove all "Load Demo Data" entry points, remove this button and optionally the `loadDemoData` usage from the header.

---

## 6. Sub-views (not top-level routes)

These are used only as tabs or children of other pages; they do not need a top-level route:

- **InvestmentOverview** – tab inside Investments.
- **SinkingFunds** – embedded in Plan.tsx.
- **ExecutionHistoryView** – not used anywhere; consider wiring as a tab or removing.

---

## 7. Summary of required fixes

| # | Item | Action |
|---|------|--------|
| 1 | Statement Upload & Statement History | Add to `Page` type, `VALID_PAGES`, and `App.tsx` router; add route(s); add nav entry or link from Transactions/Management; fix `setActivePage('Statement History')` once the type exists. |
| 2 | Wealth Ultra | In App.tsx, render `WealthUltraDashboard` for `'Wealth Ultra'` and pass `setActivePage` and `triggerPageAction`. Lazy-import WealthUltraDashboard. |
| 3 | Settings buttons | In Settings.tsx, set "Investment Plan" → `setActivePage('Investment Plan')`, "Open Wealth Ultra" → `setActivePage('Wealth Ultra')`. |
| 4 | Commodities | Either add `'Commodities'` to Page, VALID_PAGES, App, and nav (and optionally link from Zakat/Assets), or remove the "Commodities" page reference from Zakat copy. |
| 5 | Signup | Either render SignupPage when hash is `#signup` (or equivalent) in the unauthenticated branch, or remove the Sign up link / use in-page signup. |
| 6 | Load Demo Data | If removing: delete the "Load Demo Data" button (and optional `loadDemoData` usage) from Header. |
| 7 | ExecutionHistoryView | Either wire as a sub-view (e.g. in Investments) or remove if unused. |

---

## 8. Verification checklist (all addressed)

- [x] Every string passed to `setActivePage(...)` is a member of the `Page` type.
- [x] Every `Page` in the type has a `case` in `App.tsx` renderPage() and a corresponding lazy-loaded component.
- [x] Every item in Header nav groups exists in `NAVIGATION_ITEMS` (Header looks up by name).
- [x] No orphan page component that is intended to be reachable: Statement Upload, Statement History, Commodities, WealthUltraDashboard, and SignupPage are routed; ExecutionHistoryView is wired as Investments sub-tab.
- [x] Settings and other in-app links that say "Investment Plan" or "Wealth Ultra" navigate to the correct page.
- [x] "Load Demo Data" has been removed from the UI (Header profile dropdown).
