# Gap implementation — master todo list

**Source of truth for gaps:** [`GAP_MATRIX.md`](./GAP_MATRIX.md).  
**How to use:** Work top-to-bottom; check `[x]` when done. **(A)** = tests / jobs.

---

## Phase 0 — Foundation (data trust)

- [x] **0.1**–**0.6** As before (dupes, reconcile, stale data, FX, audit, etc.).

---

## Phase 1 — Transaction intelligence

- [x] **1.1** Internal transfers excluded from KPIs.
- [x] **1.2**–**1.4** Merchants, salary, subscriptions — **Analysis** + **Dashboard** subscription strip.
- [x] **1.5** Split expenses — **Transactions** modal (≥2 lines, `validateSplitTotal`); stored via `note` + `transactionSplitNote.ts`.
- [x] **1.6** Refund pairs — `findRefundPairs`; **Analysis → Possible refund pairs**.
- [x] **1.7** BNPL stub — **Analysis**.

---

## Phase 2 — Unified finance metrics

- [x] **2.1**–**2.6** Including `computeLiquidNetWorth` on **Summary**.

---

## Phase 3 — Goals

- [x] **3.1**–**3.4** Waterfall, bonus rules, **weak cashflow** banner when runway &lt; 2 mo.

---

## Phase 4 — Portfolio math

- [x] **4.1** Unrealized PnL on dividend payers.
- [x] **4.2** MWRR — Dividend Tracker + Risk hub.
- [x] **4.3**–**4.6** **Yield on cost (YoC)** on top dividend payers; **attribution v2** — external cashflow between last two NW snapshots + residual (**Risk hub**).

---

## Phase 5 — Decision engines

- [x] **5.1**–**5.5** Trading policy + Record Trade gates.

---

## Phase 6 — Scenario & stress

- [x] **6.1**–**6.3** Forecast.

---

## Phase 7–10 — Pages, security

- [x] **7.x** Financial Journal.
- [x] **8.x** Liquidation planner.
- [x] **9.x** Risk & Trading hub + NW snapshots.
- [x] **10.x** `AI_GROUNDING.md`, backup reminder, **mask balances** toggle (**Settings**) → Dashboard net worth, Summary NW/liquid, Accounts cards & rows & transfer modal.

---

## Notifications extras

- [x] Goals 0% allocation nudge.

---

**Also:** `docs/IMPLEMENTATION_COVERAGE.md` (where each capability lives), `supabase/migrations/add_transactions_note.sql` (splits/memos), salary-vs-spend **Notifications** + **Analysis**, NW attribution on **Summary** (admin).

*Phased checklist items are implemented. Items in GAP_MATRIX §1–28 beyond this list remain future product scope (TWRR, thesis DB, encrypted backup, etc.).*
