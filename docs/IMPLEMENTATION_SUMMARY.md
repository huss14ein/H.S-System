# Implementation Summary – Routes, Wiring & Enhancements

**Date:** 2025-03-15  
**Scope:** Full routing fix, wiring of all pages, Signup flow, Load Demo Data removal, Dashboard/Statement enhancements, type fix.

---

## 1. Routing & wiring

### 1.1 New pages in `Page` type and App router
- **Statement Upload** – Added to `types.ts` `Page`, `VALID_PAGES`, and `App.tsx`; lazy-loaded; route renders `StatementUpload` with `setActivePage`.
- **Statement History** – Added to `Page`, `VALID_PAGES`, and App; lazy-loaded; route renders `StatementHistoryView` with `setActivePage`.
- **Commodities** – Added to `Page`, `VALID_PAGES`, and App; lazy-loaded; route renders `Commodities` (no props).

### 1.2 Wealth Ultra
- **Before:** `case 'Wealth Ultra'` rendered `InvestmentPlanView` (“Temporary mapping”).
- **After:** Renders `WealthUltraDashboard` with `setActivePage` and `triggerPageAction`. Lazy import for `WealthUltraDashboard` added in `App.tsx`.

### 1.3 Recovery Plan & AI Rebalancer (top-level)
- **Recovery Plan:** Now receives `setActivePage` and `onOpenWealthUltra={() => setActivePage('Wealth Ultra')}` when opened as a top-level route.
- **AI Rebalancer:** Now receives `onOpenWealthUltra={() => setActivePage('Wealth Ultra')}` when opened as a top-level route.

### 1.4 Navigation (constants & Header)
- **constants.tsx:** `NAVIGATION_ITEMS` extended with:
  - **Statement Upload** (icon: `DocumentArrowUpIcon`)
  - **Statement History** (icon: `DocumentTextIcon`)
  - **Commodities** (icon: `CubeIcon`)
- **Header.tsx nav groups:**
  - **Management:** Added “Statement Upload” (after Transactions).
  - **Strategy:** Added “Commodities” (after Assets).

---

## 2. Settings

- **Settings.tsx:** “Investment Plan” button now calls `setActivePage?.('Investment Plan')` instead of `setActivePage('Dashboard')`. “Open Wealth Ultra Autopilot” now calls `setActivePage?.('Wealth Ultra')` and label shortened to “Open Wealth Ultra”.

---

## 3. Auth & Signup

- **App.tsx:** When `!isAuthenticated`, the app now respects the hash:
  - `#signup` → render `SignupPage`.
  - Otherwise → render `LoginPage`.
- **Hash sync:** `authHash` state and `hashchange` listener added so that “Log in” on SignupPage (which sets `window.location.hash = ''`) switches the view back to LoginPage.
- **SignupPage** was already implemented; it is now reachable via the “Sign up” link on LoginPage (when `VITE_ALLOW_SIGNUP === 'true'`).

---

## 4. Load Demo Data

- **Header.tsx:** “Load Demo Data” button removed from the profile dropdown. When the user has no data (`!hasData`), only “Clear All My Data” is hidden; no demo load button is shown. `loadDemoData` was removed from the destructuring of `DataContext` in Header.

---

## 5. Statement History view

- **StatementHistoryView:** Optional prop `setActivePage?: (page: Page) => void` added. When provided, the page layout shows an action button “Upload New Statement” that calls `setActivePage('Statement Upload')`. App passes `setActivePage` when rendering Statement History.

---

## 6. Dashboard

- **Quick next steps:** Added a second bullet: “Import from statements (bank, SMS, or trading)” linking to `setActivePage('Statement Upload')`.

---

## 7. Types

- **types.ts – Transaction:** Optional field `statementId?: string` added for linking a transaction to the statement it was imported from (used by Statement Upload and Transactions page for “source” display).

---

## 8. Database (existing and optional)

### 8.1 Already present
- **supabase/migrations/add_financial_statements_table.sql** defines:
  - `public.financial_statements` – uploaded statement metadata (file, bank, account, status, dates, etc.).
  - `public.extracted_transactions` – rows extracted from statements, with optional `matched_transaction_id` to main `transactions` table.

No new migrations were added in this pass.

### 8.2 Optional future change
- If the main **transactions** table is used to persist imported transactions and you want to store the statement source in the DB, add a nullable column, e.g.:
  - `statement_id UUID REFERENCES public.financial_statements(id) ON DELETE SET NULL`
- The app already uses `Transaction.statementId` in the UI; a migration would only be needed for server-side persistence of that link.

---

## 9. Files touched

| File | Changes |
|------|--------|
| `types.ts` | Added `Statement Upload`, `Statement History`, `Commodities` to `Page`; added `Transaction.statementId?`. |
| `App.tsx` | Lazy imports for StatementUpload, StatementHistoryView, WealthUltraDashboard, Commodities; added cases in `renderPage()`; Wealth Ultra → WealthUltraDashboard; Recovery/AI Rebalancer props; auth hash state + SignupPage when `#signup`; Statement History given `setActivePage`; Zakat and Transactions given `setActivePage`; Commodities given `setActivePage`. |
| `constants.tsx` | NAVIGATION_ITEMS: Statement Upload, Statement History, Commodities; new icon imports. |
| `components/Header.tsx` | Nav groups: Statement Upload (Management), Commodities (Strategy); removed Load Demo Data button and `loadDemoData` usage. |
| `pages/Settings.tsx` | Investment Plan and Wealth Ultra buttons now navigate to correct pages. |
| `pages/StatementHistoryView.tsx` | Optional `setActivePage` prop; “Upload New Statement” action in PageLayout. |
| `pages/Dashboard.tsx` | Quick step: “Import from statements” → Statement Upload. |
| `pages/Investments.tsx` | Execution History tab (type, tab array, renderContent case; ExecutionHistoryView, ClockIcon imports). |
| `pages/Transactions.tsx` | setActivePage prop; description; “Import from statements” button; ArrowDownTrayIcon import. |
| `pages/Zakat.tsx` | setActivePage prop; clickable Investments and Commodities in hint. |
| `pages/Commodities.tsx` | setActivePage prop; “Zakat Calculator” button in action area; loading state when `loading \|\| !data`. |
| `pages/Assets.tsx` | Null-safe `data?.assets` / `data?.commodityHoldings`; loading state when `loading \|\| !data`. |
| `services/householdBudgetEngine.ts` | HOUSEHOLD_ENGINE_PROFILES, generateSaudiBudgetCategories (SaudiBudgetCategorySuggestion[]), buildHouseholdEngineInputFromPlanData. |
| `pages/Budgets.tsx` | generateCommonScenarios goals mapping; safe HOUSEHOLD_ENGINE_PROFILES access; suggestedProfile cast; Spending Trends optional chaining. |
| `types.ts` | FinancialData.budgetRequests; Budget.destinationAccountId; Holding.holdingType. |
| `docs/DB_CHANGES.md` | Optional columns: budgets.destination_account_id, holdings.holding_type; budget_requests reference. |
| `pages/Summary.tsx` | Quick actions: Transactions and “Import statements” buttons. |
| `docs/IMPLEMENTATION_SUMMARY.md` | New file (this document); updated with Execution History and cross-links. |

---

## 10. Follow-up pass: type fixes, null-safety, DB doc (same session)

### 10.1 Household Budget Engine (`services/householdBudgetEngine.ts`)
- **HOUSEHOLD_ENGINE_PROFILES** – Added and exported: `Record<HouseholdEngineProfile, { label, description }>` for Moderate, Conservative, Aggressive, Growth (used by Budgets UI).
- **generateSaudiBudgetCategories** – Implemented: returns `SaudiBudgetCategorySuggestion[]` (category, limit, period, tier) with KSA-oriented suggested limits from adults, kids, monthly salary, and profile; used by Budgets “Auto-Create Saudi Household Budgets”.
- **buildHouseholdEngineInputFromPlanData** – Implemented: builds `HouseholdBudgetPlanInput` from plan-style arrays (monthly income/expense, accounts, goals, options); used by Plan page.

### 10.2 Types (`types.ts`)
- **FinancialData** – Added optional `budgetRequests?: BudgetRequest[]`.
- **Budget** – Added optional `destinationAccountId?: string` (for budget destination routing in DataContext).
- **Holding** – Added optional `holdingType?: string` (for DB persistence in DataContext).

### 10.3 Budgets page
- **generateCommonScenarios** – Goals passed as `input.goals.map(g => ({ name: g.name, remaining: max(0, targetAmount - currentAmount) }))` to match `Array<{ name; remaining }>`.
- **HOUSEHOLD_ENGINE_PROFILES[engineProfile]** – Safe access with `?.description ?? ''`.
- **suggestedProfile** – Cast to `unknown` then `{ suggestedProfile?: string }` for type-safe access.
- **Spending Trends** – Optional chaining for `month.totalActualOutflow`, `month.totalPlannedOutflow`, `month.month`; fallbacks to avoid undefined.

### 10.4 Assets page
- **Null-safety** – All `data.assets` / `data.commodityHoldings` uses `data?.assets ?? []` and `data?.commodityHoldings ?? []` in useMemo, handlers, and JSX.
- **Loading state** – Early return with spinner when `loading || !data` (with `loading` from DataContext).

### 10.5 Commodities page
- **Loading state** – Spinner when `loading || !data` inside PageLayout content.

### 10.6 Database changes doc (`docs/DB_CHANGES.md`)
- New section **Optional columns (app-compatible)**:
  - `budgets.destination_account_id` (uuid, nullable) – for budget destination routing.
  - `holdings.holding_type` (text) – for ticker vs manual_fund.
  - Reference to `budget_requests` table in `supabase/multi_user_governance.sql` / `all_db_changes_and_enhancements.sql`.

### 10.7 TypeScript
- `npm run typecheck` passes after the above changes (household engine exports, types, Budgets/Assets/Commodities fixes).

---

## 11. Execution History (audit item 7)

- **Investments.tsx:** Added **Execution History** as a sub-tab:
  - `InvestmentSubPage` type extended with `'Execution History'`.
  - `INVESTMENT_SUB_PAGES` now includes `{ name: 'Execution History', icon: ClockIcon }`.
  - `renderContent()` has `case 'Execution History': return <ExecutionHistoryView />`.
  - Import for `ExecutionHistoryView` and `ClockIcon` added. ExecutionHistoryView is no longer an orphan; it is reachable from the Investments tab bar.

---

## 12. Cross-links and optional enhancements

- **Zakat:** Receives `setActivePage` from App. The hint under Zakatable Assets now has clickable **Investments** and **Commodities** buttons when `setActivePage` is provided (navigate to those pages to change Zakat classification).
- **Transactions:** Receives `setActivePage` from App. Page description added. Header action area: **Import from statements** button (navigates to Statement Upload) plus **Add Transaction**. Reduces manual data entry by promoting statement import.
- **Commodities:** Receives `setActivePage` from App. Action area: **Zakat Calculator** button (when `setActivePage` provided) plus **Add Commodity**.
- **Summary:** Quick-action buttons extended with **Transactions** and **Import statements** (navigate to Transactions and Statement Upload).

---

## 13. Verification checklist

- [x] Every string passed to `setActivePage(...)` in modified code is a valid `Page`.
- [x] Statement Upload and Statement History are reachable from nav and from each other.
- [x] Wealth Ultra route shows WealthUltraDashboard.
- [x] Commodities is a valid route and in Strategy nav.
- [x] Settings “Investment Plan” and “Open Wealth Ultra” navigate correctly.
- [x] Signup flow: “Sign up” → SignupPage; “Log in” → LoginPage.
- [x] Load Demo Data removed from Header.
- [x] Dashboard quick step links to Statement Upload.
- [x] Transaction type supports `statementId` for statement source tracking.
- [x] Execution History is wired as an Investments sub-tab.
- [x] Zakat links to Investments and Commodities; Commodities links to Zakat; Transactions links to Statement Upload; Summary links to Transactions and Statement Upload.
