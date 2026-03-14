# Plan: Privacy, Budget, Notifications, Market Events & Transfer

This document plans the 12 requested items. Implementation order and file references are included.

---

## 1. Monthly investment plan private per user (admin cannot view others)

**Current:** `investment_plan` is loaded in DataContext with `.eq('user_id', auth.user.id)`. RLS in `supabase/rls_policies_optional.sql` restricts to `auth.uid() = user_id`. So only the owner can read/write their row.

**Gap:** Ensure no admin bypass. If an "admin" role can run arbitrary queries (e.g. service role or a policy that allows `role = 'Admin'` to select any row), they could see other users’ plans.

**Actions:**
- Confirm there is **no** RLS policy or app path that lets Admin read other users’ `investment_plan` or `portfolio_universe`. Keep policy strictly: `auth.uid() = user_id`.
- Add RLS to `wealth_ultra_config` if it holds per-user data: `using (user_id is null or auth.uid() = user_id)` so system-wide row is readable, per-user only by owner.
- In app: never fetch `investment_plan` by another user id; keep single `.eq('user_id', auth.user.id)` (or equivalent) in DataContext.

**Files:** `supabase/rls_policies_optional.sql`, `supabase/full_schema_for_app.sql` (RLS for wealth_ultra_config), `context/DataContext.tsx` (fetch logic).

---

## 2. Request new category budget after approval – display correctly

**Current:** When admin finalizes a **NewCategory** request, the code only:
- Inserts into `categories` (name, monthly_limit, total_spent).
- Updates `budget_requests` to status Finalized.

It does **not** insert into `budgets` (user-level budget rows with month/year/category/limit). So the new category exists in governance but does not appear as a normal budget row for the requester (or admin) in the current month.

**Actions:**
- On **Finalize** for NewCategory, after inserting into `categories` and updating the request:
  - Insert a **budget** row for the **requester** (`request.user_id`) for the **current month/year** with category = new category name, limit = approved amount, same period/tier as other budgets. Use existing `budgets` table and app conventions (e.g. `user_id`, `category`, `month`, `year`, `limit`, `period`).
  - Optionally insert a budget row for the **admin** (current user) for the same category/month if admin should also track it.
- Ensure the requester’s `data.budgets` is refetched (or the new row is appended in state) so the new category shows in Budget Overview like other categories.
- If the app uses `governanceCategories` from `categories` for dropdowns, the new category will already appear there; the missing piece is the **budget** row so it shows in the same list/cards as “normal” budgets.

**Files:** `pages/Budgets.tsx` (`finalizeBudgetRequest`), `context/DataContext.tsx` (if refetch needed), Supabase schema for `budgets` (columns).

---

## 3. Shared-budget transaction visibility: current month default + filters (one place)

**Current:** Shared data is loaded in Budgets: `get_shared_budgets_for_me`, `get_shared_budget_consumed_for_me`, and `budget_shared_transactions` (owner and contributor). There is no month filter on shared transactions; they are ordered by date and shown in one list. Request history (budget_requests) and review-request UI are in separate sections.

**Actions:**
- **Default to current month** for shared-budget **transactions**: filter `budget_shared_transactions` (and any consumed totals used for “this month”) by transaction date in the **current month** when displaying “shared budget transactions” and consumed amounts for the current period.
- **Month filter:** Add a month (and optionally year) filter so the user can view **history** (e.g. previous months). Same filter can apply to: shared transactions, consumed-by-category totals, and optionally request history.
- **Single area with filters:** Consolidate into one section (e.g. “Shared budgets & requests”) with tabs or subsections: “Shared budget transactions”, “Request history”, “Review requests” (admin). Provide one shared **month/year** filter (default: current month) affecting transactions and consumed totals; request history can keep its own “status” filter and optionally be filtered by month (created_at or finalized date).
- Ensure RPCs or queries support month/year if they don’t already (e.g. `get_shared_budget_consumed_for_me` with month/year parameters, or filter in app after fetch).

**Files:** `pages/Budgets.tsx` (state for selected month/year, filter UI, filtering of shared transactions and consumed data), Supabase RPCs if changed (`get_shared_budget_consumed_for_me`, etc.).

---

## 4. Auto-create budget categories + amounts from household engine (Saudi, family size, manual trigger)

**Current:** Household engine has `householdDefaults: { adults, kids }`, dynamic baseline, and config. There is no automatic creation of budget rows from it. Categories are fixed list or from governance.

**Actions:**
- Define a **Saudi-focused default budget template**: categories and suggested monthly amounts based on **number of adults and kids** (e.g. Food, Housing, Transport, Utilities, Education, Healthcare, etc.) using typical ranges for Saudi household (can be constants or a small table).
- Add a **manual trigger** on the Budgets page (e.g. “Generate budgets from household”, only once or “Apply to current month”): call household engine with current household size (and optionally config), get suggested categories and amounts, then **create budget rows** for the **current user** for the **current month/year** for each suggested category with the suggested limit (if no budget row exists yet for that category/month). Use existing `addBudget` or DataContext API; avoid overwriting existing user budgets.
- Reuse existing household engine (e.g. `buildHouseholdBudgetPlan` or a new helper that returns suggested category amounts by family size) so the source of truth is “household + Saudi defaults”.

**Files:** `services/householdBudgetEngine.ts` (or new `services/saudiBudgetDefaults.ts`), `pages/Budgets.tsx` (button + logic to generate budgets from household), `context/DataContext.tsx` (addBudget if needed).

---

## 5. Consolidate many buttons into a dropdown

**Current:** Budgets page has several buttons in the header/action area: View (Monthly/Weekly/etc.), month nav, Smart-fill, Copy Last Month, Add Budget, and sub-page toggles (Budget Overview, Household Engine). This can feel crowded.

**Actions:**
- Group **secondary actions** into one **dropdown** (e.g. “Actions” or “More”): e.g. “Smart-fill from history”, “Copy Last Month”, and any other non-primary actions. Keep primary actions (e.g. “Add Budget”, View selector, month nav) as they are or under one compact toolbar.
- Apply the same pattern elsewhere if there are “many buttons beside each other” (e.g. Request section, Shared budgets section): one primary CTA, rest in a dropdown.
- Use a single dropdown component (e.g. native `<select>` or a custom dropdown) consistent with UI_STANDARDS.

**Files:** `pages/Budgets.tsx` (action bar layout and dropdown).

---

## 6. Approved transactions visible to admin; reflected in shared budget for all with access

**Current:** `approve_pending_transaction` updates transaction status to Approved and updates `categories.total_spent` by `budgetCategory` and amount. Shared budget consumed is tracked via `get_shared_budget_consumed_for_me` and `budget_shared_transactions`. It’s unclear if “approved” (governance) transactions are written into shared budget tables so that all users with access to that budget see the deduction.

**Actions:**
- **Admin sees approved transactions:** Ensure the Transactions page (or admin view) shows **approved** transactions as well as pending. Today filtered lists may emphasize “pending”; add or adjust so approved transactions are visible (e.g. a status filter: Pending | Approved | All, default All or Approved included).
- **Reflect in shared budget:** When a transaction is approved and it is tied to a **shared** budget (category that is shared with others), ensure the approval flow:
  - Updates category spent (already done), and
  - Inserts or updates the appropriate **shared** structure (e.g. `budget_shared_transactions` or the logic that feeds `get_shared_budget_consumed_for_me`) so that **all users who have access to that budget** see the deduction. If the current design is “shared budget = owner’s budget + contributor transactions”, then an approved transaction that belongs to the owner’s shared category should count in consumed for recipients. Verify and, if needed, add a step in approval (or in the RPC) that records the approved transaction in the shared-budget consumption path for the relevant owner/category.

**Files:** `pages/Transactions.tsx` (admin view and filters), `supabase` (e.g. `approve_pending_transaction` or a trigger that updates shared consumed when a transaction is approved), shared-budget RPCs.

---

## 7. Transaction approval notifications to admin not triggered

**Current:** Notifications are built client-side in `NotificationsContext` from `data` (budgets, goals, price alerts, etc.). There is no server-side or real-time trigger when a **transaction** is submitted for approval, so admin is not notified of “new pending transaction”.

**Actions:**
- **Option A (client-only):** When an admin loads the app (or the Transactions page), show a notification if there are **pending** transactions (e.g. “You have N pending transactions to review”). Derive this in NotificationsContext from `data.transactions` where `status === 'Pending'`, and add a notification category (e.g. “Transaction” or “Approval”) with link to Transactions (with filter Pending).
- **Option B (persistent):** Store “approval” notifications in a `notifications` table (user_id, type, payload, read_at). When a Restricted user submits a transaction with status Pending, insert a notification for each Admin (or for a role). When admin opens the app, fetch unread notifications and show them. Mark as read when admin visits the Transactions approval view.
- Prefer Option A for minimal backend change; add Option B if you need notifications to persist across devices/sessions.

**Files:** `context/NotificationsContext.tsx` (derive admin notification from pending transactions), `pages/Transactions.tsx` (optional: trigger or link).

---

## 8. Users receive notifications for their requests and can view them

**Current:** Budget requests are stored in `budget_requests`; status changes (Finalized/Rejected) are not pushed to the requester. Requester can only see status by opening Budgets and looking at request history.

**Actions:**
- **In-app notifications for request status:** In NotificationsContext (or when loading Budgets), for the **current user**, derive notifications from `budget_requests` where `user_id = auth.user.id` and `status !== 'Pending'` and (optional) `updated_at` or a “notified” flag is recent. Add a notification per finalized/rejected request (e.g. “Your budget request for X was approved” / “rejected”), with link to Budgets (or to the request history section).
- **View requests:** Ensure the Budgets page has a clear “My requests” or “Request history” section where the user sees all their requests (Pending, Finalized, Rejected) with status and, if finalized, the approved amount. This may already exist; if not, add a dedicated subsection and optionally a filter “My requests”.
- Optional: add a `notified_at` or `read_by_requester_at` on `budget_requests` so you only show “new” status changes once; then mark as read when the user opens the request history.

**Files:** `context/NotificationsContext.tsx` (notifications from budget_requests for current user), `pages/Budgets.tsx` (request history visibility and link from notifications).

---

## 9. Admin views approved budget and tracks; transactions deducted from shared accounts

**Current:** Admin can finalize budget requests and see budget requests. “Approved budget” here likely means the approved categories/limits. “Track” and “transactions deducted from shared accounts” mean: admin sees which transactions are applied against shared budgets and how much is consumed.

**Actions:**
- **Admin view of approved budget:** Ensure admin sees the same budget overview as others but for categories they have permission for, including **categories created via finalized requests** (once #2 is done, those appear as normal budget rows). Optionally an “Admin: approved categories” list sourced from `categories` + `budget_requests` (Finalized) so admin can see all approved categories and their limits.
- **Track deductions:** Provide an admin view (e.g. under Budgets or Transactions) that lists **transactions** that count against **shared** budgets: e.g. approved transactions where the category is one of the shared categories, with owner/category/amount and date. Data can come from `budget_shared_transactions` and/or approved `transactions` with `budget_category` in a shared category. Ensure the shared-consumed totals (e.g. `get_shared_budget_consumed_for_me` for the owner, or an admin RPC) reflect these deductions so “track” is consistent.
- If “shared accounts” means literal **accounts** (e.g. a shared bank account), then ensure there is an account-level concept: which account the transaction is from, and that shared budgets can be tied to “shared accounts” so that when a transaction is approved from that account, it deducts from the shared budget. Current design may be category-based; extend if needed.

**Files:** `pages/Budgets.tsx` (admin section: approved categories + list of transactions affecting shared budgets), `pages/Transactions.tsx` (filter by shared category for admin), Supabase (RPC or view for admin to get “transactions deducted from shared budget” per owner/category).

---

## 10. When sharing account, option to allow view balance or not

**Current:** Codebase has budget sharing (shared budgets with recipients). There is no clear “account sharing” (sharing an account like Checking/Savings with another user) with a “show balance” toggle.

**Actions:**
- **Model:** Add an **account sharing** concept: e.g. table `account_shares` (owner_user_id, account_id, recipient_user_id, can_view_balance boolean, created_at). When `can_view_balance` is false, the recipient sees the account (e.g. in a dropdown or list) but not the balance (show “—” or “Hidden”).
- **UI:** Where accounts are shared (e.g. in Accounts or a sharing modal), add a checkbox or toggle “Allow recipient to view balance”. On save, set `can_view_balance` in the share record.
- **Application:** When loading accounts for a recipient (e.g. for transfers or display), join with `account_shares` and if `can_view_balance` is false, replace `balance` with null or a sentinel so the UI never displays the real balance.
- If “sharing” is currently only budget-based, this is a new feature: account-level sharing with balance visibility control.

**Files:** New migration (e.g. `account_shares` table), `context/DataContext.tsx` or loaders (apply balance visibility when returning accounts to a recipient), `pages/Accounts.tsx` (share UI and toggle).

---

## 11. Market events: accurate data, clear impact and actions; US/market general events; more AI

**Current:** Market Events page uses Finnhub economic calendar plus local estimated events (NFP, CPI, PPI, earnings, dividends). Impact is generic (High/Medium/Low). There is no clear “what this means for you” or “what to do”.

**Actions:**
- **Accuracy:** Prefer **real** event dates from Finnhub (or another provider) where available; use estimated dates only when no API data. Validate and fix date/time handling (timezone, “US market” vs local).
- **US / general market events:** Add or surface a section “US market & macro” (e.g. FOMC, NFP, CPI, PPI, major earnings cycles) so users see broad market impact. Reuse or extend Finnhub calendar and the existing estimated macro events.
- **Impact on user:** For each event, show:
  - **Portfolio impact:** e.g. “Affects X of your holdings” (symbols in user’s portfolios/watchlist that are related to the event), and a short line “Likely impact: rates / tech / oil …”.
  - **What to do:** Add an AI-generated short line per event (or per event type): “Consider: review bond allocation before FOMC” or “No action needed for your portfolio.” Use existing AI service; prompt with event title, date, user’s holdings list, and ask for 1–2 sentences of guidance (educational, not advice).
- **More AI:** Optionally add an “Explain this event” or “How this affects me” button that calls AI with event + user context and displays the result in the event card.

**Files:** `pages/MarketEvents.tsx` (structure, filters, US/macro section, impact line, “what to do”), `services/finnhubService.ts` (calendar data), `services/geminiService.ts` (AI for impact/action text).

---

## 12. Option to transfer between accounts (e.g. savings, retirement)

**Current:** No transfer feature. (Separate from “funds available from transfer” in Record Trade, which is just a label.)

**Actions:**
- **Feature:** Add **Transfer** flow: user selects “From” account, “To” account, amount, optional date and note. On submit:
  - Debit “From” (e.g. add a `transfer_out` transaction or expense).
  - Credit “To” (e.g. add a `transfer_in` transaction or income).
  Keep balances consistent with existing account/transaction model (e.g. update account balances if they are derived from transactions, or write two transactions and recompute).
- **UI:** Place in **Accounts** page (e.g. “Transfer” button → modal or inline form). Support any account type (Checking, Savings, Investment, etc.) so user can transfer e.g. Checking → Savings, Savings → Investment (and optionally record as deposit on investment side).
- **Data:** Either two transactions (type `transfer_out` / `transfer_in`) linked by a shared `transfer_id`, or a single `transfers` table; ensure DataContext and any balance logic stay consistent.

**Files:** `context/DataContext.tsx` (e.g. `addTransfer(fromAccountId, toAccountId, amount, ...)` or two `addTransaction` calls), `pages/Accounts.tsx` (Transfer button + form/modal).

---

## Implementation order (suggested)

| Phase | Items | Rationale |
|-------|--------|-----------|
| 1     | 1 (investment plan private), 2 (approved request → budget row) | Privacy and correct display of approved requests. |
| 2     | 3 (shared transactions: current month + filters, one place), 6 (approved in shared budget), 9 (admin track) | Shared-budget consistency and admin experience. |
| 3     | 7 (admin approval notifications), 8 (user request notifications) | Notifications without new tables if using client-derived notifications. |
| 4     | 5 (dropdown buttons), 4 (household → budgets) | UX cleanup and auto-budgets. |
| 5     | 10 (account share balance visibility), 12 (transfer) | New features (account sharing + transfer). |
| 6     | 11 (market events + AI) | Bigger UX and integration. |

---

## Summary table

| # | Requirement | Main change |
|---|-------------|-------------|
| 1  | Investment plan private; admin can’t view others | Ensure RLS only; no admin read bypass; add RLS for wealth_ultra_config if per-user. |
| 2  | Approved new-category request displays like normal budget | On finalize NewCategory, insert budget row(s) for requester (and optionally admin) for current month. |
| 3  | Shared-budget transactions: current month default, filter by month; one place with filters | Default to current month; add month/year filter; consolidate shared transactions + request history + review in one section. |
| 4  | Auto-create budgets from household (Saudi, family size, manual trigger) | Saudi default template by adults/kids; “Generate budgets from household” creates budget rows for current month. |
| 5  | Fewer buttons: consolidate into dropdown | Group secondary actions (Smart-fill, Copy, etc.) into one Actions dropdown on Budgets. |
| 6  | Approved transactions visible to admin; reflected in shared budget | Show approved in admin view; ensure approval flow updates shared-budget consumed for all with access. |
| 7  | Transaction approval notifications to admin | Derive “N pending transactions” notification for admin in NotificationsContext (and optionally persist). |
| 8  | Users get notifications for their requests; can view them | Notifications from budget_requests (Finalized/Rejected) for current user; clear “My requests” in Budgets. |
| 9  | Admin views approved budget and tracks; deductions from shared accounts | Admin view of approved categories and list of transactions deducting from shared budgets; consistent consumed totals. |
| 10 | When sharing account, option to allow view balance | Add account_shares (or similar) with can_view_balance; enforce in UI when showing balance to recipient. |
| 11 | Market events: accurate, clear impact and actions; US/market; more AI | Real dates where possible; US/macro section; “affects you” + “what to do” (AI); optional “Explain” button. |
| 12 | Transfer between accounts | Add Transfer flow (from/to/amount) in Accounts; two transactions or one transfers table; support any account types. |
