# Manual QA checklist (non-tax)

Use this to satisfy release-style verification. **Income-tax flows are out of product scope** (Zakat remains on its own page). Automated checks: `npm run test` (lint + `tsc`).

## 1. Household engine & buckets

- Open **Budgets** (or **Plan** if buckets are surfaced there).  
- Set income/expense scenario with at least one **Core** and one **Discretionary** category.  
- Confirm bucket totals update when budgets change; no console errors.

## 2. Budget sync

- Create or edit a monthly budget limit; save.  
- Refresh the page; confirm the limit persists and **Dashboard** / **Summary** reflect spending vs plan where wired.

## 3. AI automation (uncategorized)

- Add a transaction with vague description and no category.  
- Run categorization / AI flow if exposed on **Transactions** or **Budgets**.  
- Confirm a category is suggested or applied without breaking save.

## 4. Market Events calendar

- Open **Market Events**.  
- Switch list/calendar if present; confirm events render for watchlist + holdings and filters do not blank the view.

## 5. Assets CRUD

- **Assets**: add, edit, delete a non-commodity asset; **Commodities**: add holding, update price if available.  
- Totals on cards match the visible rows (personal scope / owner rules as documented on page).

## 6. Forecast vs Summary (net worth)

- Note **Summary** net worth (personal scope).  
- Open **Forecast**; compare baseline NW projection’s starting point to Summary for the same date/currency — large drift may indicate scope mismatch (document if intentional).

## 7. Duplicate detection

- **Transactions**: import or create two rows with same date, amount, similar description; confirm duplicate warning or highlight if implemented.  
- **Budgets**: duplicate category/month guard if present.

## 8. Validations

- Try invalid forms (empty amount, end date before start, negative quantity on trades); confirm inline errors and no silent data loss.

## 9. Timezones & dates

- Create transactions near month boundaries; confirm they appear in the intended month on **Budgets** / **Analysis** charts.

## 10. Currency conversion

- Toggle display currency in header (if available); confirm **Summary** / **Accounts** / key cards rescale consistently; spot-check one SAR/USD conversion against `CurrencyContext` rate.

---

*Mark these steps in your release notes when executed; `npm run test` does not replace this list.*
