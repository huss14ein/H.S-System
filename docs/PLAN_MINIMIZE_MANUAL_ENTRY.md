# Plan: Minimize Manual Entry in the System

## Goal
Reduce how much users must type or select by hand: use smart defaults, pre-fill from existing data, one-click flows, templates, and optional import so the system feels lightweight to use.

---

## Current manual-entry points (summary)

| Area | What user enters today | Already automated / defaulted |
|------|-------------------------|------------------------------|
| **Transactions** | Date, amount, description, type, account, category, budget category, nature, expense type | Date = today for new; first account/category in dropdowns; **AI suggest category** on button click; local fallback from description |
| **Recurring** | Description, amount, type, account, category, day of month, enabled | "Apply for this month" creates actual transactions from template |
| **Budgets** | Category, limit, period, tier — one by one | (Planned: "Generate from household" → full set in one action) |
| **Accounts** | Name, type, owner | None; empty form |
| **Goals** | Name, target amount, deadline, priority | None; empty form |
| **Plan / Household** | Salary (or from plan data), adults, kids, monthly overrides | Adults/kids in state; income derived from transactions on Budgets; profile can be stored |
| **Investment (record trade)** | Type, symbol, quantity, amount, price, account, date, reason | Some context from watchlist/portfolio when opened with initial data |
| **Liabilities** | Name, type, amount, etc. | None |
| **Assets** | Name, type, value, purchase price, owner | None |

---

## Strategies (by area)

### 1. Transactions

- **Default date**: Keep today for new transactions (already in place).
- **Remember last-used**: Persist "last used" **account** and **budget category** (and optionally type) in `localStorage` (e.g. `finova-last-tx-account`, `finova-last-tx-budgetCategory`). On opening Add Transaction, pre-fill these so repeat entries (e.g. same account, same category) require less selection.
- **Auto-suggest category on description blur**: When user leaves the description field (onBlur) and description is non-empty, automatically call the same logic as "AI suggest" (AI + local fallback) and set category/budget category without a button click. Optionally show a small "Suggested: Food" chip so user can accept or change. Reduces one click and makes category feel automatic.
- **Promote recurring**: For users who add the same transaction often (e.g. monthly salary, rent), show a hint: "Create a recurring rule for this?" after save, or detect similar description+amount in last 2 months and suggest creating a recurring template. Once created, "Apply for this month" reduces future manual entry.
- **Optional (later)**: CSV/bank import to create many transactions at once (date, description, amount, then batch categorize with AI or rules). Large reduction in manual entry for power users.

**Files**: `pages/Transactions.tsx` (defaults, last-used load/save, onBlur suggest), optional `utils/lastUsedPreferences.ts` or keys in existing storage.

---

### 2. Budgets

- **Generate from household**: Implement the planned household-engine suggested budgets (see plan `household_engine_suggested_budgets_ksa`). One action fills all categories with suggested limits; user only reviews/edits. This is the main reduction for budget entry.
- **Copy from previous month**: If already present, keep it; otherwise add "Copy from [previous month]" so user doesn’t re-enter the same limits every month.

**Files**: `pages/Budgets.tsx`, `services/householdBudgetEngine.ts` (or `householdSuggestedBudgets.ts`).

---

### 3. Accounts

- **One-click "Add standard accounts"**: A single button or link: "Add standard set". It creates 2–3 placeholder accounts (e.g. "Main Checking", "Savings", optionally "Credit Card") with default types and empty balance. User can rename or delete; no need to add each account from scratch.
- **Templates**: In the Add Account modal, offer quick templates: "Checking", "Savings", "Credit Card", "Investment" with a suggested name (e.g. "Main Checking") pre-filled; user only confirms or edits name.

**Files**: `pages/Accounts.tsx` (button + handler that calls addAccount N times or a bulk create in DataContext).

---

### 4. Goals

- **Goal templates**: In Add Goal, offer 2–3 templates: e.g. "Emergency Fund" (suggested target = 6 × monthly expenses if available from plan/transactions, or a placeholder 50,000 SAR), "Down Payment", "Vacation" with placeholder target and deadline (e.g. 2 years from today). User picks a template and can edit amount/deadline.
- **Infer from household**: If household engine or plan has an "emergency reserve" or target (e.g. 6 months expenses), suggest an "Emergency Fund" goal with that amount and a reasonable deadline so user doesn’t type from scratch.

**Files**: `pages/Goals.tsx` (templates in modal or a "Start from template" dropdown), optional link to plan/household for suggested amount.

---

### 5. Plan / Household

- **Persist household profile**: Save `householdAdults`, `householdKids`, and optionally overrides to Supabase (user settings or a small `household_profile` table) or at least `localStorage`. On load, pre-fill the form so user doesn’t re-enter every time.
- **Infer salary from transactions**: On Plan or Budgets, if "monthly salary" is empty, compute average monthly income from the last 3–6 months of transactions and pre-fill a "Suggested monthly income: X SAR" that the user can accept or edit. Reduces manual salary entry when transactions already exist.

**Files**: `pages/Plan.tsx`, `pages/Budgets.tsx` (load/save profile, suggest income from transactions), DataContext or Supabase for profile persistence.

---

### 6. Investment (record trade)

- **Pre-fill from context**: When opening Record Trade from a holding (e.g. "Record trade" on a row), pre-fill symbol, account (the portfolio’s account), and default date = today. When opening from watchlist, pre-fill symbol. Reduce to: amount/quantity and optionally price/reason.
- **Default date**: Always default trade date to today when modal opens for a new trade.
- **Remember last account**: If user has multiple investment accounts, remember last-used account in localStorage and pre-fill next time.

**Files**: `pages/Investments.tsx` (RecordTradeModal initial data and defaults).

---

### 7. Liabilities and Assets

- **Templates**: In Add Liability, offer templates: "Credit Card", "Car Loan", "Mortgage", "Personal Loan" with a suggested name and type pre-filled; user enters amount and optional details. Same idea for Assets: "Property", "Vehicle" with placeholder name and type.
- **Link to account (optional)**: When adding a Credit Card liability, if the user has a Credit account with the same or similar name, suggest linking or pre-fill the account so the liability and account stay in sync (optional, higher effort).

**Files**: `pages/Liabilities.tsx`, `pages/Assets.tsx` (template buttons or dropdown that pre-fill name/type).

---

### 8. Recurring transactions

- **Apply for multiple months**: In addition to "Apply for this month", add "Apply for next 3 months" or "Apply for rest of year" so one click creates several months of transactions from the same rule. Reduces repeated manual application.
- **Suggest recurring after repeat transaction**: When user saves a transaction that matches (by description or category+amount) a transaction from the previous month, show a one-line prompt: "Create a recurring rule for this?" with a link to open the recurring modal pre-filled (description, amount, category, account).

**Files**: `pages/Transactions.tsx` (recurring section and post-save suggestion).

---

## Implementation priority

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| High | Household suggested budgets (generate all categories + limits) | Removes N manual budget entries | Medium (plan exists) |
| High | Transaction: remember last-used account + category; auto-suggest category on description blur | Fewer clicks and selects per transaction | Low |
| High | Accounts: "Add standard set" or templates | Fewer steps for new users | Low |
| Medium | Goals: templates (Emergency Fund, etc.) with suggested target | Less typing for common goals | Low |
| Medium | Plan/Budgets: persist household profile; infer salary from transactions | No re-entry of adults/kids/salary | Medium |
| Medium | Investment: pre-fill symbol/account/date from context | Fewer fields when recording a trade | Low |
| Medium | Recurring: "Apply for next 3 months" + suggest recurring after repeat transaction | Fewer repeated manual entries | Low–Medium |
| Lower | Liabilities/Assets: templates (name + type) | Slight reduction in typing | Low |
| Later | CSV/import for transactions | Large reduction for bulk data | High |

---

## Consistency

- **Defaults**: Every "Add" modal should default date to today where applicable (transactions, trades, etc.) and pre-fill from context or last-used when available.
- **Single source of truth**: Reuse existing data (transactions for income, household profile for adults/kids, budgets for categories) so we infer instead of asking again.
- **Storage**: Use a small set of keys (e.g. under `finova-` or user settings in Supabase) for "last used" and household profile so behavior is consistent and easy to extend.

---

## Summary

- **Transactions**: Last-used account/category, auto category suggest on description blur, suggest recurring when repeat detected.
- **Budgets**: Generate from household (planned); keep copy-from-previous-month.
- **Accounts**: Add standard set or templates.
- **Goals**: Templates with suggested targets.
- **Plan/Household**: Persist profile; infer salary from transactions.
- **Investment**: Pre-fill from holding/watchlist context; default date; last-used account.
- **Liabilities/Assets**: Templates for name and type.
- **Recurring**: Apply for multiple months; suggest creating recurring after repeat transaction.

These changes keep the system flexible while minimizing manual entry and re-entry.
