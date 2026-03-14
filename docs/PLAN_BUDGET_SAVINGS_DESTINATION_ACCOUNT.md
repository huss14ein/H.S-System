# Plan: Savings in Budget Goes to a Specific Account

## Goal
When the user has a **Savings & Investments** budget (or any budget they use for “savings”), they can designate a **specific account** that those savings go to. The system then:
- Stores and displays that link (e.g. “Savings → Main Savings”).
- Can pre-fill or suggest that account when recording a transaction in that budget category.

---

## Current state
- **Budget** ([types.ts](types.ts)): `category`, `limit`, `month`, `year`, `period`, `tier`. No account link.
- **Transaction**: has `accountId` (the account the transaction is from/to). User picks the account manually when adding a transaction.
- **Savings & Investments** is a standard budget category; expenses in that category (e.g. transfers to savings) are tracked against the budget, but there is no notion of “this budget’s savings go to account X”.

---

## 1. Data model

### 1.1 Budget type (app)
Add an optional field to the `Budget` interface:

- **`destinationAccountId?: string`** — When set, this budget’s “savings” (or transfer) are intended to go to this account. Used when `category === 'Savings & Investments'` (and optionally other categories later).

### 1.2 Database
Add a nullable column to the `budgets` table:

- **`destination_account_id`** — `text` or `uuid`, nullable. Stores the id of the account (from `accounts` or app state) that receives the savings for this budget.

**Migration** (e.g. in [full_schema_for_app.sql](supabase/full_schema_for_app.sql) or a new migration file):

```sql
alter table if exists public.budgets
  add column if not exists destination_account_id text default null;
comment on column public.budgets.destination_account_id is 'Account id where savings for this budget (e.g. Savings & Investments) are directed. Used to pre-fill transaction account and show "Savings → Account name" on Budgets page.';
```

---

## 2. Budget modal (Add/Edit)

- When the user selects (or edits) a budget whose **category** is **"Savings & Investments"**, show an extra field:
  - **Label**: “Savings go to account” (or “Destination account”).
  - **Control**: Dropdown listing the user’s **Checking**, **Savings**, and **Investment** accounts (from `data.accounts`). Option like “None” or leave empty so the field stays optional.
- When category is not Savings & Investments, hide this field (or show only for categories you later define as “savings-like”).
- On save: include `destinationAccountId` in the payload (optional; send `null` or omit when “None”).
- On load (edit): pre-fill from `budgetToEdit.destinationAccountId`.

**Files**: [pages/Budgets.tsx](pages/Budgets.tsx) — BudgetModal: add state `destinationAccountId`, dropdown when `category === 'Savings & Investments'`, pass in `onSave`.

---

## 3. DataContext (persist and load)

- **addBudget**: Include `destination_account_id` in the payload when present (and ensure Supabase column exists). Map app `destinationAccountId` to snake_case for DB.
- **updateBudget**: When updating a budget, include `destinationAccountId` in the payload and in the `.update()` so the DB and local state stay in sync. Match by `user_id`, `category`, `month`, `year` as today.
- **Copy budgets** (e.g. “Copy Last Month”): When copying a budget row, copy `destinationAccountId` as well so the new month’s Savings & Investments budget keeps the same destination account.
- **Load budgets**: Ensure the column is selected when fetching budgets so `data.budgets[].destinationAccountId` is available (map `destination_account_id` → `destinationAccountId` if the API returns snake_case).

**Files**: [context/DataContext.tsx](context/DataContext.tsx) — addBudget, updateBudget, copyBudgetsFromPreviousMonth, and the place where budgets are fetched (select `*` or add `destination_account_id`).

---

## 4. Budgets page (display)

- In the budget list/cards, when a budget has **category === 'Savings & Investments'** and **destinationAccountId** is set, resolve the account name from `data.accounts` and show a short line or badge, e.g. **“→ Main Savings”** or “To: Main Savings”, so the user sees at a glance where that budget’s savings go.

**Files**: [pages/Budgets.tsx](pages/Budgets.tsx) — wherever a single budget row/card is rendered, add the “→ [Account name]” when applicable.

---

## 5. Transactions (pre-fill account)

- When the user opens **Add Transaction** and selects **budget category “Savings & Investments”** (or types a description that triggers that category), **pre-fill the account** dropdown with the **destination account** from the corresponding budget, if any:
  - Find a budget for the current user with `category === 'Savings & Investments'` for the **current month/year** (or the month of the transaction being added) and `destinationAccountId` set.
  - If found, set the transaction’s account to that `destinationAccountId` so the user doesn’t have to pick it manually; they can still change it.
- This reduces manual entry and keeps “savings” transactions consistently pointing to the chosen account.

**Files**: [pages/Transactions.tsx](pages/Transactions.tsx) — TransactionModal: when `budgetCategory === 'Savings & Investments'` (or when user selects that category), look up `data.budgets` for that category in the relevant month and, if `destinationAccountId` exists, set `accountId` to that value (e.g. in a `useEffect` or when category changes).

---

## 6. Household suggested budgets (optional)

- When generating suggested budgets from the household engine, the **Savings & Investments** suggested budget does not set `destinationAccountId`; the user sets it when they first edit that budget or in the modal when they apply suggestions. No change required in the suggested-budgets API unless you later want to suggest “first Savings account” as default.

---

## 7. Summary

| Change | Description |
|--------|-------------|
| **types.ts** | Add `destinationAccountId?: string` to `Budget`. |
| **Supabase** | Add `destination_account_id` (nullable) to `budgets`. |
| **Budgets.tsx** | Budget modal: “Savings go to account” dropdown when category is Savings & Investments; list/cards: show “→ [Account name]” when set. |
| **DataContext** | addBudget, updateBudget, and copy budgets include destinationAccountId; fetch returns it. |
| **Transactions.tsx** | When category is Savings & Investments, pre-fill account from budget’s destinationAccountId. |

Result: the user can assign a **specific account** to the savings budget, see it on the Budgets page, and have that account pre-filled when recording savings transactions.
