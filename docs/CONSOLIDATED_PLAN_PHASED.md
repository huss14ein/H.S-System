# Consolidated plan (single source) — phased execution

This document **merges all feature and enhancement plans** into one master plan and organizes delivery into **phases**. Use it as the single reference for what to build and in what order.

**DB changes:** All required schema changes are in **one file**: [`supabase/unified_db_changes.sql`](../supabase/unified_db_changes.sql). Run it once after core tables exist (see [README_DB_MIGRATIONS](../supabase/README_DB_MIGRATIONS.md)).

**Before you start:** Ensure you are on the latest `main` (or your default branch): `git checkout main && git pull origin main`. If you use a worktree and see `HEAD (no branch)`, switch to `main` and pull before applying any changes so implementation is on the latest version of the system.

---

## Source plans (merged here)

| Source | Content merged |
|-------|----------------|
| **PLAN_PRIVACY_BUDGET_NOTIFICATIONS_MARKET_TRANSFER** | Items 1–12: investment plan privacy, approved request → budget row, shared-budget filters, household → budgets, dropdown buttons, approved tx visibility & shared budget, admin/user notifications, admin track, account share balance, market events + AI, transfer between accounts. |
| **PLAN_BUDGET_SAVINGS_DESTINATION_ACCOUNT** | Savings budget → specific account (data model, modal, DataContext, display, transaction pre-fill). |
| **PLAN_UI_UX_EXPAND_COLLAPSE** | General UI/UX, CollapsibleSection component, where to use expand/collapse on dense pages. |
| **PLAN_MINIMIZE_MANUAL_ENTRY** | Transactions (last-used, auto-suggest), budgets (generate, copy), accounts/goals/plan/investment/liabilities/assets templates and pre-fill, recurring (apply multi-month, suggest rule). |
| **PLAN_UNIFIED_LIGHT_THEME** | Single light theme, `.page-hero`, replace dark heroes (Investments), light tooltip (MiniPriceChart), UI_STANDARDS theme section. |
| **Cards light theme** (from prior discussion) | Card.tsx neutral light background, remove colored overlays; SectionCard overrides to neutral light on key pages. |
| **Household suggested budgets (KSA)** | Saudi-focused categories and suggested amounts by adults/kids/salary; formulas, validation, yearly budgets (Health, Education); “Generate from household” flow. |
| **Signup enabled & privacy** | Supabase config, consent checkbox + Terms/Privacy links, password validation, email confirmation UX, accessibility. |
| **Manual/unmapped fund holdings** | holding_type (ticker | manual_fund), nullable symbol, UI for “Add bank product / no ticker”, valuation from current_value. |
| **Fully wired / AI best-in-class** | Single sources of truth, AI enabled where used, dynamic/automated behavior, page-level wiring checklist. |

---

## Phase 0 — Foundation (DB & types)

**Goal:** Schema and types ready for all later phases.

| # | Task | Details |
|---|------|--------|
| 0.1 | Run unified DB migration | Execute `supabase/unified_db_changes.sql` in Supabase SQL editor. Adds: `budgets.destination_account_id`, `holdings.holding_type` + nullable `symbol`, `household_profile` table (with RLS). |
| 0.2 | App types | Add `destinationAccountId?` to `Budget`; add `holdingType?: 'ticker' \| 'manual_fund'` to holding type; ensure household profile type exists if loading from DB. |

**Exit criteria:** Migration applied; TypeScript types match new columns/tables.

---

## Phase 1 — Privacy & core correctness

**Goal:** Investment plan and budget requests behave correctly and privately.

| # | Task | Details |
|---|------|--------|
| 1.1 | Investment plan private | Confirm no RLS or app path lets Admin read other users’ `investment_plan`. Add RLS for `wealth_ultra_config` if per-user: `user_id is null or auth.uid() = user_id`. DataContext: never fetch by another user id. |
| 1.2 | Approved request → budget row | On Finalize for **NewCategory**, after inserting into `categories` and updating the request: insert a **budget** row for the **requester** (and optionally admin) for **current month/year** with category = new category, limit = approved amount. Refetch or append so new category appears in Budget Overview. |

**Files:** `supabase/rls_policies_optional.sql`, `supabase/full_schema_for_app.sql`, `context/DataContext.tsx`, `pages/Budgets.tsx` (finalizeBudgetRequest).

---

## Phase 2 — Budgets: destination account & household generation

**Goal:** Savings budget links to an account; user can generate full budget set from household (KSA-aware).

| # | Task | Details |
|---|------|--------|
| 2.1 | Savings → account (data + UI) | Budget modal: when category is “Savings & Investments”, show “Savings go to account” dropdown (Checking/Savings/Investment). DataContext: addBudget, updateBudget, copyBudgetsFromPreviousMonth include `destination_account_id`; fetch returns it. List/cards: show “→ [Account name]” when set. |
| 2.2 | Transaction pre-fill | When Add Transaction and category is “Savings & Investments”, pre-fill account from that budget’s `destinationAccountId` for current month. |
| 2.3 | Generate from household | Implement Saudi-focused suggested budgets: categories and amounts by adults, kids, salary (formulas and validation per household_engine plan). Button “Generate from household” on Budgets: create budget rows for current month (no overwrite of existing). Support yearly budgets (e.g. Health, Education) where specified. |

**Files:** `types.ts`, `context/DataContext.tsx`, `pages/Budgets.tsx`, `pages/Transactions.tsx`, `services/householdBudgetEngine.ts` (or `householdSuggestedBudgets.ts` / Saudi defaults).

---

## Phase 3 — Shared budgets & admin experience

**Goal:** Shared-budget transactions and admin views are consistent and scoped by month.

| # | Task | Details |
|---|------|--------|
| 3.1 | Shared transactions: current month + filter | Default shared-budget **transactions** to **current month**; add month/year filter. One section: “Shared budgets & requests” with month filter affecting transactions and consumed totals. |
| 3.2 | Approved tx in shared budget | When a transaction is approved and tied to a shared budget category, ensure approval flow updates shared-budget consumption so all users with access see the deduction. |
| 3.3 | Admin: approved budget & track | Admin sees approved categories (from finalized requests) in budget overview. Admin view of transactions that deduct from shared budgets (list + consumed totals). |

**Files:** `pages/Budgets.tsx`, Supabase RPCs (e.g. `get_shared_budget_consumed_for_me` with month/year if needed), `pages/Transactions.tsx`, approval flow / triggers.

---

## Phase 4 — Notifications

**Goal:** Admin and users get relevant in-app notifications.

| # | Task | Details |
|---|------|--------|
| 4.1 | Admin: pending transactions | NotificationsContext: for admin, derive “You have N pending transactions to review” from `data.transactions` where `status === 'Pending'`; link to Transactions (filter Pending). Option B: persist in `notifications` table when Restricted user submits Pending. |
| 4.2 | User: request status | NotificationsContext: for current user, derive notifications from `budget_requests` (Finalized/Rejected); “Your budget request for X was approved/rejected” with link to Budgets. Clear “My requests” / request history on Budgets. |

**Files:** `context/NotificationsContext.tsx`, `pages/Budgets.tsx`, optionally `notifications` table + RPC.

---

## Phase 5 — UI/UX: light theme, cards, buttons, expand/collapse

**Goal:** Unified light theme, neutral cards, less clutter, progressive disclosure.

| # | Task | Details |
|---|------|--------|
| 5.1 | Light theme | Add `.page-hero` in `index.css` (light bg, dark text). Replace dark heroes on Investments (main header + Investment Plan section) with light hero. MiniPriceChart tooltip: light style. Document in `docs/UI_STANDARDS.md`. |
| 5.2 | Cards light | Card.tsx: single neutral light background; remove colored gradients/overlays; keep subtle left-border semantic color. SectionCard: change colored overrides to neutral light on Investments, WealthUltraDashboard, Goals, Plan, error boundaries. |
| 5.3 | Dropdown actions | Budgets: group secondary actions (Smart-fill, Copy Last Month, etc.) into one “Actions” dropdown; keep primary (Add Budget, View, month nav) visible. Apply same pattern elsewhere where many buttons sit together. |
| 5.4 | CollapsibleSection | New `components/CollapsibleSection.tsx`: title, optional summary, defaultOpen, storageKey, accessible toggle. Use on WealthUltraDashboard, Budgets (Budget Intelligence, Household Engine, Shared), Investment Plan (execution result, proposed trades), Summary (full report), Goals (details), Plan (monthly breakdown). Prefer collapsed by default with one-line summary. |

**Files:** `index.css`, `pages/Investments.tsx`, `components/charts/MiniPriceChart.tsx`, `docs/UI_STANDARDS.md`, `components/Card.tsx`, `components/SectionCard.tsx`, `pages/Budgets.tsx`, `components/CollapsibleSection.tsx`, `pages/WealthUltraDashboard.tsx`, `pages/Summary.tsx`, `pages/Goals.tsx`, `pages/Plan.tsx`.

---

## Phase 6 — Minimize manual entry

**Goal:** Defaults, pre-fill, templates, and one-click flows reduce typing and repeated entry.

| # | Task | Details |
|---|------|--------|
| 6.1 | Transactions | Remember last-used account and budget category (e.g. localStorage); pre-fill on Add Transaction. Auto-suggest category on description blur (AI + local fallback). After save, optionally suggest “Create recurring rule?” when repeat detected. |
| 6.2 | Budgets | “Copy from previous month” if not present. Generate from household (Phase 2.3) is the main reduction. |
| 6.3 | Accounts | “Add standard set” button (e.g. Main Checking, Savings, Credit Card). Add Account modal: templates (Checking, Savings, etc.) with suggested name. |
| 6.4 | Goals | Templates: Emergency Fund, Down Payment, Vacation with suggested target/deadline. Optionally infer from household (e.g. 6× expenses for emergency). |
| 6.5 | Plan / household | Persist household profile to Supabase (`household_profile`) or localStorage; load into Plan/Budgets. Infer salary from transactions (e.g. last 3–6 months) and suggest “Suggested monthly income: X”. |
| 6.6 | Investment (record trade) | Pre-fill symbol, account, date from context (holding or watchlist); default date = today; remember last-used account. |
| 6.7 | Liabilities / Assets | Templates: Credit Card, Car Loan, Mortgage; Property, Vehicle with name/type pre-filled. |
| 6.8 | Recurring | “Apply for next 3 months” (or “rest of year”); after repeat transaction, suggest “Create recurring rule?” with pre-filled modal. |

**Files:** `pages/Transactions.tsx`, `pages/Budgets.tsx`, `pages/Accounts.tsx`, `pages/Goals.tsx`, `pages/Plan.tsx`, `pages/Investments.tsx`, `pages/Liabilities.tsx`, `pages/Assets.tsx`, `context/DataContext.tsx` (household_profile load/save if DB).

---

## Phase 7 — New features: account sharing & transfers

**Goal:** Account-level sharing with balance visibility control; transfer between accounts.

| # | Task | Details |
|---|------|--------|
| 7.1 | Account share balance visibility | Add `account_shares` (owner, account_id, recipient_user_id, can_view_balance). UI: when sharing account, “Allow recipient to view balance” toggle. When loading accounts for recipient, hide balance when `can_view_balance` is false. Include in `unified_db_changes.sql` or separate migration. |
| 7.2 | Transfer between accounts | Transfer flow: From account, To account, amount, optional date/note. On submit: debit From (e.g. transfer_out), credit To (transfer_in); keep balances consistent. UI: “Transfer” button on Accounts → modal. Support any account types. |

**Files:** New migration or extend `unified_db_changes.sql` for `account_shares`; `context/DataContext.tsx`; `pages/Accounts.tsx`.

---

## Phase 8 — Market events, manual holdings, signup

**Goal:** Market events useful and accurate; manual/unmapped funds supported; signup on and privacy-compliant.

| # | Task | Details |
|---|------|--------|
| 8.1 | Market events | Prefer real dates (e.g. Finnhub). “US market & macro” section. Per event: portfolio impact (“Affects X of your holdings”), “What to do” (AI short line). Optional “Explain this event” button. |
| 8.2 | Manual/unmapped fund holdings | Use `holding_type`, nullable `symbol` from Phase 0. UI: “Add bank product / no ticker” flow (name, quantity, current value, portfolio). List: “Manual” badge; allow manual “Edit value”. Wealth Ultra / ticker-based features exclude manual_fund; total portfolio value includes them. |
| 8.3 | Signup enabled & privacy | Supabase: email confirmation, Site URL, Redirect URLs; pass `emailRedirectTo` in signup. Signup page: required “I agree to Terms and Privacy Policy” checkbox; minimal data notice; password min length; accessibility. Success message and optional “Resend confirmation email”. |

**Files:** `pages/MarketEvents.tsx`, `services/finnhubService.ts`, `services/geminiService.ts`; holdings types and DataContext; Investments UI for manual holdings; `pages/SignupPage.tsx`, `context/AuthContext.tsx`, Supabase config.

---

## Phase 9 — Optional enhancements

**Goal:** Nice-to-haves from prior optional-enhancements list (export/reporting, recurring scheduling, read state, Wealth Ultra persist, search, accessibility, admin audit, data quality, performance, multi-currency). Implement as capacity allows; order by impact/effort.

---

## Implementation order summary

| Phase | Focus | Depends on |
|-------|--------|------------|
| **0** | DB + types | — |
| **1** | Privacy & request → budget | 0 |
| **2** | Savings account link + generate from household | 0 |
| **3** | Shared budgets + admin track | 1, 2 |
| **4** | Notifications | 1 |
| **5** | Light theme, cards, dropdown, expand/collapse | — |
| **6** | Minimize manual entry | 0, 2 (household profile + generate) |
| **7** | Account sharing + transfer | 0 (if account_shares in unified migration) |
| **8** | Market events, manual holdings, signup | 0 |
| **9** | Optional enhancements | As needed |

Phases **0, 1, 2** can start immediately after running `unified_db_changes.sql`. **5** (UI) can run in parallel with 1–4. **6** benefits from 2 and 0 (household_profile). **7** and **8** can follow once 0–4 are stable.

---

## Single DB reference

All plan-related schema changes are in:

- **[\`supabase/unified_db_changes.sql\`](../supabase/unified_db_changes.sql)**

Run once after core tables exist. For account sharing (Phase 7), add `account_shares` either in that file or in a small follow-up migration documented in the same README.
