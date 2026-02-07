# QA Review Report

## Bugs / Issues
- Command palette navigation can break when there are zero filtered commands; the arrow key handlers use modulo with `filteredCommands.length`, which becomes `0` and yields `NaN`, so selection and Enter behavior stop working.
- Command palette selection index is not reset when the query changes, so the selected index can point past the end of the filtered list and Enter does nothing.
- Budget updates/deletes are scoped only by `category` (not `user_id`), which can update/delete budgets for other users who share the same category.
- Watchlist deletion is scoped only by `symbol` (not `user_id`), which can delete other users' watchlist entries for the same symbol.
- Market price alert checks use a `Map` keyed by `symbol`, which drops additional alerts for the same symbol (only one alert per symbol can trigger).
- Demo data error handling calls `resetData()` which asks for user confirmation; if the user cancels, partial demo data remains after a failed load.

## Enhancements
- Consider adding explicit multi-tenant scoping to all update/delete queries (`eq('user_id', auth.user.id)`) to avoid accidental cross-user modifications, even when using unique IDs.
- Add explicit empty-state keyboard handling in the command palette to prevent `ArrowUp/ArrowDown` from running when there are no results, and reset selection when the query changes.
- Support multiple price alerts per symbol by grouping alerts by symbol and evaluating each threshold independently.
- Provide a non-interactive cleanup path for demo-data failures to ensure consistent rollback without an extra confirmation dialog.
