# Data model vs full wealth-system spec

Reference for **core entities** and how current types map. Gaps are listed so automation and AI can be built on clean data.

---

## User / profile

| Spec field | Current | Notes |
|------------|---------|--------|
| user id | AuthContext / Supabase `auth.uid` | ✓ |
| base currency | CurrencyContext (SAR/USD display); InvestmentPlanSettings `budgetCurrency`/`executionCurrency` | Partial; no single "profile.baseCurrency" |
| timezone | — | **Missing** |
| risk profile | Settings.riskProfile (`Conservative` \| `Moderate` \| `Aggressive`) | ✓ |
| investment style | — | **Missing** (could extend Settings) |
| family size | Plan / household budget profiles | Partial |
| salary cycle | — | **Missing** (e.g. monthly, bi-weekly) |
| policy settings | Settings, tradingPolicy | ✓ |

---

## Accounts

| Spec field | Current | Notes |
|------------|---------|--------|
| account id, name, type | Account | ✓ |
| provider / bank / broker | — | **Missing** (platformDetails exists but generic) |
| currency | — | **Missing** (inferred from plan/context) |
| opening balance | — | **Missing** |
| current balance | Account.balance | ✓ |
| status | — | **Missing** (active/closed) |
| bucket type | — | **Missing** (see AccountRole below) |
| liquidity level | — | **Missing** (used in logic: liquidNetWorth, cash allocation) |

**Types:** `AccountRole` and `AccountBucketType` are defined in `types.ts` for logic use; DB can add columns later.

---

## Transactions

| Spec field | Current | Notes |
|------------|---------|--------|
| id, date, type, category, amount, accountId | Transaction | ✓ |
| settlement date | — | **Missing** |
| subcategory | Transaction.subcategory | ✓ |
| currency | — | **Missing** (assumed account/base) |
| FX rate | — | **Missing** |
| merchant / source | Transaction.description | Partial |
| linked account, goal, asset | — | **Missing** (transfer uses category "Transfer") |
| recurring flag | recurringId | ✓ |
| notes, tags | note; no tags | Partial |
| import source | statementId | ✓ |
| reconciliation status | — | **Missing** |

**Transaction types (spec):** income, transfer, expense, investment buy/sell, dividend, interest, fee, refund, debt payment, internal reallocation, goal contribution/withdrawal, adjustment, FX conversion, cash deposit/withdrawal.  
**Current:** `Transaction.type` is `'income' \| 'expense'`; transfer implied by category. Investment moves are in `InvestmentTransaction`. A **TransactionType** union exists in types for classification logic.

---

## Assets / holdings

| Spec field | Current | Notes |
|------------|---------|--------|
| id, symbol, type, account, quantity, cost basis, market value | Holding | ✓ |
| region, sector | — | **Missing** |
| dividend yield | Holding.dividendYield | ✓ |
| risk class, conviction level, status | — | **Missing** (partially in Wealth Ultra / Recovery) |

---

## Goals

| Spec field | Current | Notes |
|------------|---------|--------|
| id, name, target amount, target date, current funded, priority | Goal | ✓ |
| inflation rule, pause flag | — | **Missing** |
| linked account, contribution rule, success threshold | — | **Missing** |

---

## Liabilities

| Spec field | Current | Notes |
|------------|---------|--------|
| id, lender, type, amount, status | Liability | ✓ |
| remaining balance, rate, monthly payment, maturity, prepayment, payoff priority | — | **Missing** (liabilityMetrics uses annual payment for DSR) |

---

## Watchlist idea

| Spec field | Current | Notes |
|------------|---------|--------|
| symbol, name | WatchlistItem | ✓ |
| target buy range, fair value, quality/valuation score, catalyst date, risk/thesis note, status | — | **Missing** (decisionEngine ranks; no structured fields) |

---

## Rules / config

| Spec field | Current | Notes |
|------------|---------|--------|
| rule name, type, active, threshold, priority | Settings; tradingPolicy (load/save) | Partial |
| source module, last changed | — | **Missing** (auditLog logs changes) |

---

## Snapshots

| Spec field | Current | Notes |
|------------|---------|--------|
| date, net worth | NetWorthSnapshot (localStorage) | ✓ minimal |
| cash, debt, investment value, allocation, realized/unrealized return, goal funding %, risk score, cash runway | — | **Missing** (recommended extension for attribution and reports) |

---

## Enums / types added for logic (types.ts)

- **AccountRole** — operating_cash, salary_receiving, bills_payment, emergency_reserve, investment_funding, trading_capital, long_term_savings, goal_reserve, debt_servicing.
- **AccountBucketType** — operating \| reserve \| provision \| goal \| investable.
- **TransactionType** — income, transfer, expense, investment_buy, investment_sell, dividend, interest, fee, refund, debt_payment, goal_contribution, goal_withdrawal, adjustment, fx_conversion, cash_deposit, cash_withdrawal (for classifyTransaction output).
- **Profile** — optional type with baseCurrency, timezone, riskProfile, investmentStyle, familySize, salaryCycle (for future use).

These support the logic layer without requiring immediate DB migration.
