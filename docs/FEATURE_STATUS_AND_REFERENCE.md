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
- **Related links:** A **“Related:”** line under the hero includes **Portfolios** · **Watchlist** (tickers + **Trade advices (AI)** card on that tab) · **AI Rebalancer** · **Recovery Plan** (and **Wealth Ultra** when available). Each switches the Investments sub-tab. **Location:** `pages/Investments.tsx` — **Investment Plan** tab, after the dark hero section (~**lines 2781–2796**).

---

## 9. Investment pages – cross-links and navigation

- **Tabs:** Overview, Portfolios, Investment Plan, Recovery Plan, **Watchlist**, **AI Rebalancer**, Dividend Tracker, Execution History. **Trade advices (AI)** live on the **Watchlist** tab (`WatchlistView`), not a separate tab.
- **In-context link:** On the **Investment Plan** tab, the **“Related:”** line (see §8) jumps to Portfolios, Watchlist, AI Rebalancer, and Recovery Plan.

---

## 10–11. Finnhub – sole API and full free options

**Current use**

- **Quote:** `services/geminiService.ts` — `getFinnhubLivePrices` (quote), `getFinnhubCommodityPrices` (crypto → SAR), and commodity flow uses Finnhub first for BTC/ETH.
- **News / economic calendar:** `getFinnhubCompanyNews`, `getFinnhubEconomicCalendar`, `buildFinnhubResearchBrief` used in research/context.

**Implemented in `services/finnhubService.ts` and UI**

- Market status (US exchange session; normalized via `normalizeFinnhubMarketSession` — see `docs/AI_GROUNDING.md`).
- Market holidays (System Health).
- Company profile, basic financials / metrics, quote + **52-week** (metrics), earnings calendar, insider, news, economic calendar.
- Watchlist: live prices, 52w context, research modal; **LivePricesStatus** shows US session when live + API key.

Stooq/simulated prices may still be used as fallbacks where configured; Finnhub is the primary live feed when `VITE_FINNHUB_API_KEY` is set.

---

## 12. Market research – deeper on Watchlist

- **Current:** Watchlist uses news + economic calendar (e.g. Finnhub) and AI research. **File:** `pages/WatchlistView.tsx`; API/context in `services/geminiService.ts` (e.g. `buildFinnhubResearchBrief`, AI research).
- **Deeper** optional next steps: richer per-symbol dashboards, more charting, or additional Finnhub endpoints not yet surfaced in the row UI.

---

## 13. Trade advise – smarter logic and UI

- **Current:** **Investments → Watchlist** sidebar **“Trade advices (AI)”**: preview of recent **personal** trades, **`getAITradeAnalysis`** with holdings / watchlist / plan / risk profile / as-of date; Markdown sections include **Do’s** and **Don’ts**. See `pages/WatchlistView.tsx` + `TradeAnalysisContext` in `services/geminiService.ts`.

---

## 14. Scenario planning – “!” on each field and reuse

- **Plan** (`pages/Plan.tsx`): InfoHints on household intelligence, liquid cash, total debt, life-event modal fields, scenario controls (income shock, expense stress, events, year), and related labels where added in the scenario/plan pass.
- **Forecast** (`pages/Forecast.tsx`): InfoHints on forecast assumptions, auto-fill, run forecast, scenario comparison, goal projections, etc.
- Further polish: align exact wording across Plan vs Forecast for any duplicate concepts (optional).

---

## 15. Plan page – smarter logic and tracking

- **Current:** **Plan** (`pages/Plan.tsx`) — executive summary (projected surplus, actual net, variance %, months over budget); **Progress vs plan** card (income / expenses excl. investment / monthly investment planned vs actual for YTD or full selected year); **Plan fed from** cross-links including **Forecast**; goals vs surplus analysis; household engine signals when applicable. History of plan version edits is not stored (optional future).

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

- **Bell + badge:** **`components/Header.tsx`** — `notificationCount` from **`useNotifications()`**; click opens **Notifications**.
- **Optional sound:** Web Audio short beep when the count **increases** or when opening the bell with unread items — only if **Settings → Notification sound** is on (**`PrivacyContext`**, `localStorage` `finova_notification_sound_v1`, default **off**).

---

## 20. AI Services API (Gemini)

- **Documentation:** **`docs/AI_GROUNDING.md`** — feature → primary file table, env keys (`GEMINI_API_KEY`, `VITE_GEMINI_API_KEY`), Finnhub session note, privacy.
- **Code:** **`services/geminiService.ts`** (+ Netlify proxy where used); surfaces include AI advisor, trade analysis, watchlist tips, rebalance, parsers, etc.
- **System Health:** “AI Services API (Gemini)” health row exercises the proxy/model.
- **If something fails:** capture the error from browser/network or System Health; typical causes are missing `GEMINI_API_KEY` on the host or proxy timeouts.

---

## Status summary

| # | Item | Status | Notes |
|---|------|--------|--------|
| 5 | Window alignment | Done | Main content in `Layout.tsx`: `w-full` on main + inner div. Clarified it’s the main app content area, not a specific “add window”. |
| 7 | Can’t add trade | Done (docs + UX) | Exact steps and error cases documented above. Modal already shows empty state when no accounts/portfolios; validation and API errors documented. |
| 8 | Sleeve strategy “!” + Watchlist/AI link | Done | All allocation fields have InfoHints. **Related:** Portfolios · Watchlist · AI Rebalancer · Recovery Plan on Investment Plan tab. |
| 9 | Investment pages cross-links | Done | Tab bar; trade advices on **Watchlist** tab; **Related** links on Investment Plan. |
| 10–11 | Finnhub sole API + full free options | Done | `services/finnhubService.ts`: market status, holidays, company profile, basic financials, quote + 52w, earnings calendar, insider, news, economic calendar. System Health shows market status and holidays. |
| 12 | Market research deeper on Watchlist | Done | Per-symbol Research (book icon) opens modal with Finnhub: profile, quote and 52w, earnings, insider, news. |
| 13 | Trade advise smarter + UI | Done | Richer AI prompt (tx list + instructions); card layout, empty states, styled analysis panel. |
| 14 | Scenario planning “!” and reuse | Done | Plan + Forecast InfoHint pass (assumptions, scenarios, household fields, etc.); see §14 above. |
| 15 | Plan page smarter + tracking | Done | Executive summary + **Progress vs plan** (YTD/full-year income, expenses, investment) + Forecast links + goals vs surplus. |
| 16 | Metals & Crypto update | Done (location doc’d) | Code locations listed above; Finnhub + AI flow in place. If still broken, debug with console/Supabase. |
| 18 | Ring notification | Done | Web Audio beep when count increases and on bell click when count greater than 0. Header.tsx. |
| 20 | AI Services API (Gemini) | Done (docs) | **`docs/AI_GROUNDING.md`** + System Health check; fix behavior when you have a concrete error. |
