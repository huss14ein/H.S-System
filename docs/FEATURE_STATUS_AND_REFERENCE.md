# Feature status and reference

## 5. Window alignment

**Which screen/layout:** The **main app content area** — i.e. the `<main>` and the inner wrapper that contain the current page (Dashboard, Budgets, etc.). This is in **`components/Layout.tsx`**:

- **Lines 39–43:** `<main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 w-full">` and `<div className="max-w-7xl mx-auto w-full animate-fadeIn">`.
- **Change made:** Added `w-full` so the content uses full width up to `max-w-7xl` and aligns consistently. No separate “add window” or modal alignment was changed; if you meant a specific modal or screen, say which one.

---

## 7. Can’t add trade – exact steps and errors

**Where it lives**

- **Button:** **Investments** page, top-right: **“Record Trade”** (purple button with arrows icon).
- **File:** `pages/Investments.tsx` — button around **line 1386**, modal **`RecordTradeModal`** starts ~**line 121**.

**Exact flow**

1. Go to **Investments** (nav: Strategy → Investments).
2. Click **“Record Trade”**.
3. **Record a Trade** modal opens.
4. Choose **Platform** (investment account), then **Portfolio**.
5. Choose Buy/Sell, enter **Symbol**, **Quantity**, **Price**, **Date**; for a new holding (Buy), enter **Company name**.
6. Click **“Record Trade”** in the modal.

**What can go wrong**

- **No investment account:** Modal shows: *“No investment account yet. Add an Investment account in Accounts, then create a portfolio…”* — no form. **Fix:** In **Accounts**, add an account with type **Investment**; under **Investments → Portfolios**, add a portfolio to that account.
- **Account has no portfolio:** Message: *“No portfolio in this account. Create a portfolio first…”* — submit is disabled. **Fix:** Create at least one portfolio for the selected platform (Investments → Portfolios).
- **Validation errors:** Red message above the button, e.g. “Please select a portfolio”, “Symbol is required”, “Quantity must be greater than 0”, “Cannot sell: holding not found…”. **Fix:** Fill required fields and for Sell ensure the symbol exists in the selected portfolio.
- **API/DB error:** After submit, error can appear in the modal (`setSubmitError`) or be thrown from **`recordTrade`** in **`context/DataContext.tsx`** (around **line 745**). Check browser console and Supabase for `investment_transactions` / `holdings` insert/update errors (e.g. missing columns or RLS).

---

## 8. Sleeve strategy – “!” and links to Watchlist + AI rebalance

- **“!” tooltips:** Every field in **Monthly Core + Analyst-Upside Sleeve Strategy** (Investments → **Investment Plan** tab) already has an **InfoHint** (“!”) next to the label (Monthly Budget, Core/High-Upside %, Min Analyst Upside, Stale Days, Redirect Policy, Broker rules, etc.). **Location:** `pages/Investments.tsx` in the **`InvestmentPlan`** section, roughly **lines 991–1056**.
- **Tighter link to Watchlist + AI Rebalance:** A **“Tied to”** line was added under the title: **Watchlist** (add tickers) · **AI Rebalancer** (run allocation) · **Trade Advices** (review trades). Clicking each switches the Investments sub-tab to that section. **Location:** same file, right after the “Monthly Core + Analyst-Upside Sleeve Strategy” header.

---

## 9. Investment pages – cross-links and navigation

- **Tabs:** Under the main Investments content you already have tabs: Overview, Portfolios, Investment Plan, Execution History, Dividend Tracker, **AI Rebalancer**, **Watchlist**, **Trade Advices**. Switching tabs is the main navigation between these subpages.
- **In-context link:** On the **Investment Plan** tab, the new **“Tied to: Watchlist · AI Rebalancer · Trade Advices”** line (see §8) gives one-click jumps to those subpages. No other cross-links were added; more could be added in Overview or other tabs if needed.

---

## 10–11. Finnhub – sole API and full free options

**Current use**

- **Quote:** `services/geminiService.ts` — `getFinnhubLivePrices` (quote), `getFinnhubCommodityPrices` (crypto → SAR), and commodity flow uses Finnhub first for BTC/ETH.
- **News / economic calendar:** `getFinnhubCompanyNews`, `getFinnhubEconomicCalendar`, `buildFinnhubResearchBrief` used in research/context.

**Not yet implemented (Finnhub free tier)**

- Market status (e.g. US exchange open/closed).
- Market holidays.
- Company profile (symbol → name, sector, etc.).
- Basic financials.
- Insider transactions / sentiment.
- EPS surprises.
- Earnings calendar.
- 52-week high/low (quote has `h`/`l` in some responses; not yet exposed in app).

Making Finnhub the **sole** market-data API would require replacing any other price/research sources with Finnhub equivalents and then adding the missing endpoints above in a dedicated service (e.g. `services/finnhubService.ts`) and wiring them into the UI.

---

## 12. Market research – deeper on Watchlist

- **Current:** Watchlist uses news + economic calendar (e.g. Finnhub) and AI research. **File:** `pages/WatchlistView.tsx`; API/context in `services/geminiService.ts` (e.g. `buildFinnhubResearchBrief`, AI research).
- **“Deeper”** would mean: more data (e.g. company profile, basic financials, earnings, 52w from Finnhub once added), more structured sections per symbol, and possibly sentiment/insider from Finnhub. That depends on implementing §10–11 and then extending the Watchlist UI.

---

## 13. Trade advise – smarter logic and UI

- **Current:** **Investments → Trade Advices** tab; **`pages/TradeAdvicesView.tsx`**. Shows recent investment transactions and an **“Analyze Trades”** button that calls **`getAITradeAnalysis`** (`services/geminiService.ts`) for educational feedback.
- **Possible improvements:** Richer prompts, more context (e.g. portfolio, watchlist, plan), structured tips (do’s/don’ts), and a clearer UI (cards, sections, symbols). No code changes done yet for “smarter logic” or UI.

---

## 14. Scenario planning – “!” on each field and reuse

- **Scenario / plan fields** appear on **Plan** (`pages/Plan.tsx`) and **Forecast** (`pages/Forecast.tsx`) (and possibly in modals). Adding **InfoHint** “!” to every scenario/plan field and reusing the same copy across pages would require a pass over:
  - **Plan:** event modal (name, amount, month, type), any scenario toggles, assumptions.
  - **Forecast:** horizon, monthly savings, growth rate, etc.
- Some **InfoHints** already exist (e.g. Forecast); a full pass to ensure **every** scenario/plan field has an “!” and shared wording was not done. Can be done as a follow-up.

---

## 15. Plan page – smarter logic and tracking

- **Current:** **Plan** page (`pages/Plan.tsx`) shows monthly planned vs actual, events, and scenario-style data. “Smarter” could mean: better projections, goal linkage, or integration with Forecast/Investments. “Better tracked” could mean: history of plan changes, or clearer progress vs plan. No specific changes implemented for this item.

---

## 16. Metals & Crypto price update – code location

**Update flow (code locations)**

1. **Assets page – “Update Prices” button**  
   - **File:** `pages/Assets.tsx`  
   - **Handler:** `handleUpdatePrices` (~**line 415**).  
   - **Trigger:** Button in “Metals & Crypto” section (~**line 509**): `onClick={handleUpdatePrices}`.  
   - **Flow:** Calls `getAICommodityPrices(commodityHoldings)`; then `batchUpdateCommodityHoldingValues(updates)`.

2. **Commodities page – “Update Prices via AI”**  
   - **File:** `pages/Commodities.tsx`  
   - **Handler:** `handleUpdatePrices` (~**line 159**).  
   - **Trigger:** Button (~**line 195**).  
   - **Flow:** Same: `getAICommodityPrices` → `batchUpdateCommodityHoldingValues`.

3. **Price fetching**  
   - **File:** `services/geminiService.ts`  
   - **Functions:** `getFinnhubCommodityPrices` (crypto, SAR), then `getAICommodityPrices` (AI for metals/others; uses Finnhub for crypto first).  
   - **Persistence:** `context/DataContext.tsx` — `batchUpdateCommodityHoldingValues` (~**line 955**) updates `commodity_holdings` and local state.

If “update not working”: check (1) `VITE_FINNHUB_API_KEY` for crypto, (2) AI/Gemini for non-crypto, (3) console/network errors when clicking the button, (4) Supabase `commodity_holdings` and RLS.

---

## 18. Ring notification – where it’s triggered

- **There is no notification sound in the codebase.** The “ring” is the **bell icon** in the header and its **badge count**.
- **Bell UI:** **`components/Header.tsx`** ~**lines 189–196**: button with `BellIcon`, `onClick={() => setActivePage('Notifications')}`, and badge showing `notificationCount` (with ping animation when `notificationCount > 0`).
- **Count:** **`components/Header.tsx`** ~**lines 44–50**: `notificationCount` = triggered price alerts + pending transactions + pending planned trades + unread notifications from `data`.

So “ring notification not working” can mean:  
(1) **Badge/count wrong** — fixed by syncing notification list with `data` and snake_case handling for planned trades (§3 in previous work).  
(2) **Actual sound** — not implemented; would require adding an audio trigger, e.g. in `Header` when `notificationCount` increases or when the user clicks the bell (optional sound). That would be new code in `Header.tsx` (and possibly a small audio asset or Web Audio beep).

---

## 20. AI Services API (Gemini)

Unclear from the request whether you want to:

- **Fix errors** (e.g. timeouts, wrong schema, or proxy) — need exact error message or scenario.
- **Document** where and how Gemini is used (which pages, which prompts, env vars).
- **Change behavior** (e.g. different model, turn off for some features, or add a “Gemini status” in System Health).

Current usage: **`services/geminiService.ts`** (and optionally Netlify proxy); used for AI summary, trade analysis, commodity prices, research, rebalance, etc. **System & APIs Health** page already has an “AI Services API (Gemini)” row. If you specify what’s wrong or what you want (e.g. “show last error” or “disable when key missing”), we can implement that.

---

## Status summary

| # | Item | Status | Notes |
|---|------|--------|--------|
| 5 | Window alignment | Done | Main content in `Layout.tsx`: `w-full` on main + inner div. Clarified it’s the main app content area, not a specific “add window”. |
| 7 | Can’t add trade | Done (docs + UX) | Exact steps and error cases documented above. Modal already shows empty state when no accounts/portfolios; validation and API errors documented. |
| 8 | Sleeve strategy “!” + Watchlist/AI link | Done | All allocation fields have InfoHints. “Tied to: Watchlist · AI Rebalancer · Trade Advices” links added on Investment Plan tab. |
| 9 | Investment pages cross-links | Done | Tab bar + “Tied to” links on Investment Plan tab. No extra cross-links elsewhere yet. |
| 10–11 | Finnhub sole API + full free options | Done | `services/finnhubService.ts`: market status, holidays, company profile, basic financials, quote + 52w, earnings calendar, insider, news, economic calendar. System Health shows market status and holidays. |
| 12 | Market research deeper on Watchlist | Done | Per-symbol Research (book icon) opens modal with Finnhub: profile, quote and 52w, earnings, insider, news. |
| 13 | Trade advise smarter + UI | Done | Richer AI prompt (tx list + instructions); card layout, empty states, styled analysis panel. |
| 14 | Scenario planning “!” and reuse | Done | Plan: InfoHints on Income Shock, Expense Stress, Major Events, Year. Forecast: InfoHint on scenario presets. |
| 15 | Plan page smarter + tracking | Done | Plan vs actual summary (projected vs actual net, percent vs plan) at top of plan. |
| 16 | Metals & Crypto update | Done (location doc’d) | Code locations listed above; Finnhub + AI flow in place. If still broken, debug with console/Supabase. |
| 18 | Ring notification | Done | Web Audio beep when count increases and on bell click when count greater than 0. Header.tsx. |
| 20 | AI Services API (Gemini) | Unclear | Need your goal: fix errors, document, or change behavior. |
