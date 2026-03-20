# Wealth Segmentation (Personal vs Managed)

**Purpose:** "My" net worth and all user-facing KPIs, cards, and AI analysis use **personal wealth only**. Items with an `owner` set (e.g. "Father") are **managed for someone else** and are excluded from "my" totals but still visible for management.

---

## Data model

- **`owner`** (optional string) on: `Account`, `Asset`, `Liability`, `InvestmentPortfolio`, `CommodityHolding`.
- **Personal** = `owner` is empty: `null`, `undefined`, `""`, or `"null"` / `"undefined"` (string) so DB/API don’t misclassify.
- **Managed** = `owner` is any non-empty label (e.g. "Father", "Trust").

DB: optional `owner` column on `accounts`, `assets`, `liabilities`, `investment_portfolios`, `commodity_holdings` (migration: `supabase/migrations/add_owner_column_wealth_segmentation.sql`).

---

## Architecture (best practice)

1. **Single source of truth**  
   `utils/wealthScope.ts`: `isPersonalWealth()`, `getPersonalWealthData()`. All filtering logic lives here.

2. **Central merge**  
   `DataContext` calls `getPersonalWealthData(data)` and merges into `data` as `personalAccounts`, `personalAssets`, `personalLiabilities`, `personalInvestments`, `personalCommodityHoldings`, `personalTransactions`. Consumers receive one object; no ad-hoc filtering in pages.

3. **Safe consumption**  
   Use `(data as any)?.personalAccounts ?? data?.accounts ?? []` (and same for other entities) so:
   - DataContext data (with `personal*` set) uses personal arrays.
   - Tests or code that only have raw `FinancialData` still work.

4. **Transactions**  
   `personalTransactions` = transactions whose `accountId` is in `personalAccounts`. Income/expense and runway use this so "my" cashflow is correct.

5. **Investment flows**  
   When using `investmentTransactions` for "my" ROI or capital flows, filter by personal account IDs (e.g. `personalAccountIds.has(t.accountId)`).

---

## UI

- **OwnerBadge**  
  Show "Managed: {owner}" on cards for accounts, assets, liabilities, portfolios, commodities when `owner` is set.
- **Tooltips**  
  e.g. "Personal wealth only. Items with Owner set are excluded from this total." on net worth / summary cards.
- **Wealth under management**  
  On Summary: one card showing total managed wealth (full net worth − personal net worth) so the user sees both "mine" and "managed" at a glance.

---

## AI

- All prompts that use financial data receive **personal-only** inputs (transactions, accounts, investments, etc.).
- Default system instruction includes **PERSONAL_WEALTH_SCOPE**: tell the model that all data is the user’s personal wealth and not to reference or mix in third-party/managed wealth.

---

## When adding new features

- **Cards / amounts / KPIs** that represent "the user" → use `personal*` arrays (or equivalent from context).
- **Lists** for management (e.g. all liabilities) → can show all; use `personal*` only for **totals** and ratios.
- **New services** that take `FinancialData` and compute user metrics → use `(data as any)?.personalX ?? data?.x ?? []`.
- **Statement upload / duplicate check** → keep using **all** accounts and **all** transactions by design.

See `utils/wealthScope.ts` and `context/DataContext.tsx` for the canonical implementation.
