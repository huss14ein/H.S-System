# Engine & feature UX guidelines

Use this when adding **new services**, **engine outputs**, or **dashboard sections**.

## Defaults

1. **Zero extra steps** — Prefer `useMemo` from `DataContext` + `personal*` scope (`getPersonalWealthData` / `personalAccounts` etc.). User should not configure a screen to see a first result.
2. **Explain in place** — Put a short **(!) InfoHint** on the section via `SectionCard`’s `infoHint` prop (what it measures, data source, limits, “not advice” if needed).
3. **Sensible fallbacks** — Empty goals, no snapshots, or zero balances should show a **one-line next action** (link with `setActivePage` when possible), not a dead end.
4. **Automation (client)** — Full server cron is out of scope unless you add jobs; on the client, safe automation includes:
   - Recompute when `data` changes (React deps).
   - Re-read **localStorage**-backed state on `visibilitychange` if other tabs or flows write it (e.g. net worth snapshots).
   - One-click helpers (e.g. “Fill last 2 snapshot dates”) instead of many manual fields.

## Components

| Pattern | Use |
|--------|-----|
| `SectionCard` + `infoHint` | Any non-obvious metric or engine block |
| `InfoHint` alone | Table headers, dense forms |
| `PageLayout` `description` | Page-level scope + disclaimer in one sentence |

## Copy

- State **currency** (SAR vs display currency) when numbers are ambiguous.
- Prefer **“illustration” / “demo” / “simplified”** where the model is not audited performance.

## See also

- [`AI_GROUNDING.md`](./AI_GROUNDING.md) — prompts and PII
- [`GAP_MATRIX.md`](./GAP_MATRIX.md) — depth vs spec
