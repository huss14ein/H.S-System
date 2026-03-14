# Plan: UI/UX Enhancements and Expand/Collapse

## Goal
1. **Enhance UI and UX** across the app (clarity, consistency, hierarchy, reduced clutter).
2. **Use expand/collapse** on pages with a lot of detail so users see a summary by default and open sections only when needed.

---

## Part 1: General UI/UX enhancements

- **Visual hierarchy**: Use clear heading levels (page title → section title → subsection). Ensure section titles stand out (e.g. `section-title` or `text-lg font-semibold text-dark`) and body text is slightly muted (`text-slate-600` / `text-slate-700`) so the eye lands on key info first.
- **Spacing and density**: Keep consistent vertical rhythm (`space-y-6` or `space-y-8` between major sections). Avoid cramped blocks; use `p-4`–`p-6` inside cards. On dense tables, consider alternating row background or increased row padding for readability.
- **Progressive disclosure**: Lead with the most important number or action (e.g. "Deployable cash", "Next action"); put secondary details (formulas, logs, long lists) behind expand/collapse or "Show details" (see Part 2).
- **Consistency**: Use `PageLayout` for every main page (title, optional description, primary action). Use `SectionCard` for content blocks; use design tokens from [UI_STANDARDS.md](UI_STANDARDS.md) (`.btn-primary`, `.input-base`, `.section-card`, etc.). Keep the **light theme** unified (no dark hero bands; cards and sections use light backgrounds).
- **Empty and loading states**: Every list or table should have a clear empty state (e.g. "No transactions this month — Add one") and a loading state (spinner or skeleton) so the page never feels broken.
- **Accessibility**: Expand/collapse controls must be keyboard-usable and have `aria-expanded` and `aria-controls`; section headings that toggle content should be focusable (button or link). Keep focus management in modals (trap focus, return focus on close).

---

## Part 2: Expand/collapse pattern

### 2.1 Reusable component: `CollapsibleSection`

Add a shared component so all pages use the same behavior and styling.

**Location**: `components/CollapsibleSection.tsx`

**Props** (example):
- `title: string` — Label shown when collapsed and when expanded.
- `children: ReactNode` — Content shown only when expanded.
- `defaultOpen?: boolean` — Initial state (default `false` for "summary first").
- `summary?: ReactNode` — Optional one-line summary or badge (e.g. "3 alerts", "12 positions") shown in the header when collapsed so the user knows what's inside without expanding.
- `storageKey?: string` — Optional key for persisting open/closed in `localStorage` (e.g. `collapsible-wealth-ultra-alerts`) so preference is remembered across visits.
- `className?: string` — Extra classes for the wrapper (e.g. to match `section-card`).
- `ariaId?: string` — Id for the content panel (for `aria-controls` / `aria-labelledby`).

**Behavior**:
- Header: title + optional summary + chevron icon (rotates when open). Clicking the header toggles expand/collapse.
- Use native `<details>` and `<summary>` for simplicity and accessibility, **or** a button with `aria-expanded` and a div that shows/hides content. Prefer `<details>` if you don't need to persist state; use state + `localStorage` if you want "remember open/closed".
- When `storageKey` is set, read initial open state from `localStorage` and write on toggle. Default to collapsed when no key or first visit.
- Style the header so it looks like a section title (e.g. same as `SectionCard` title) with a chevron on the right. Content area: same padding as section body, optional border-top for separation.

**Accessibility**:
- Toggle is focusable; Enter/Space toggles.
- `aria-expanded="true"|"false"` on the toggle.
- `aria-controls` pointing to the id of the content panel.
- Optional `aria-labelledby` linking panel to the title.

### 2.2 Where to use expand/collapse

Use **CollapsibleSection** (or equivalent) for any block that is long or secondary so the page shows a short summary by default and details on demand.

| Page | Section / block | Collapsed summary (what user sees when closed) | Notes |
|------|------------------|------------------------------------------------|-------|
| **WealthUltraDashboard** | Engine hero + KPIs | Keep visible (main value). | — |
| | Engine Intelligence & Decision Summary | "Engine IQ: 72 — 3 actions" (or one line) | Expand for full actions list and details. |
| | Sleeve Allocation & Drift | "Core 65%, Upside 22%, Spec 13%" (one line) | Expand for table and drift details. |
| | Generated Orders | "5 BUY, 2 SELL" (counts) | Expand for full order list. |
| | Monthly Deployment / Spec Status / Alerts | One-line summary each | Expand for full content. |
| | All Positions / Top Gainers / Top Losers | "12 positions" / "3 gainers" / "2 losers" | Expand for tables. |
| | Capital Efficiency, Exception History, Risk Distribution | Title + count or one line | Expand for tables/charts. |
| **Budgets** | Request search + filters + stats | "Pending: 2, Finalized: 5" (or keep filters visible, collapse table) | Expand for request list and request form block. |
| | Budget Intelligence | "Portfolio 45k, Spend 32k, 2 need attention" | Expand for full metrics and top change. |
| | Auto Household Budget Engine | "Salary 20k, 2 adults, 1 kid" (one line) | Expand for full table and overrides. |
| | Budget sharing / Shared-budget transactions | "2 shared budgets" / "5 transactions" | Expand for forms and tables. |
| **Investments (Investment Plan tab)** | Plan health | Keep one-line summary; optional "Details" expand for breakdown. | — |
| | Execution result / Proposed trades | "3 trades suggested" | Expand for full list and audit log. |
| | Universe / Holdings tables | "15 tickers" / "8 holdings" | Expand for full table when list is long (e.g. > 5 rows). |
| **Plan** | 12-month grid | Keep summary row; optional "Monthly breakdown" per row or per section | Expand for per-category or per-month detail. |
| **Summary** | AI report / long text | First 2–3 lines + "Show full report" | Expand for full markdown content. |
| **Notifications** | List of notifications | First 5 items + "Show more" (or "Load more") | Pagination or expand to show next N. |
| **Goals** | Per goal card | Title + progress bar visible; "Details" (linked assets, timeline) expandable | Expand for description and linked assets. |
| **Liabilities / Assets** | Long tables | First 5 rows + "Show all" or collapse "Additional entries" | Optional; if list is short, no need. |

**Default state**: Prefer **collapsed** for dense sections (Engine Intelligence, Orders, All Positions, Household table, Shared transactions, etc.) so the first view is scannable. Keep **expanded** only for the one block that is the primary focus of the page (e.g. main KPI cards).

---

## Part 3: Implementation notes

### 3.1 Component API (suggested)

```tsx
// Example usage
<CollapsibleSection
  title="Engine Intelligence & Decision Summary"
  summary="IQ 72 — 3 actions"
  defaultOpen={false}
  storageKey="wealth-ultra-engine-iq"
>
  <div className="grid ..."> ... </div>
</CollapsibleSection>
```

- If you use `<details>`: no need for `storageKey` in v1; browser may remember state in some cases. For consistent "remember my choice" across sessions, use state + `storageKey`.
- Wrap existing `SectionCard` content in `CollapsibleSection`, or make `SectionCard` accept an optional `collapsible` prop that renders the title as the collapse trigger and the body as the expandable content. Prefer one shared `CollapsibleSection` that can wrap any content (including a SectionCard) for flexibility.

### 3.2 Styling

- Header: same font and weight as `.section-title`; chevron (e.g. `ChevronDownIcon`) rotated 180° when open. Use `transition` for smooth rotate.
- Content: padding and border consistent with `section-card` body; avoid double borders when nested inside a card.
- Light theme: header and content use light background (white or slate-50); no dark blocks.

### 3.3 Files to add or change

| File | Change |
|------|--------|
| `components/CollapsibleSection.tsx` | **New**: Collapsible section with title, optional summary, optional persistence, accessible toggle. |
| `docs/UI_STANDARDS.md` | Add short section: "Expand/collapse: use CollapsibleSection for long or secondary content; prefer collapsed by default; provide a one-line summary when closed." |
| `pages/WealthUltraDashboard.tsx` | Wrap each major SectionCard (or block) in CollapsibleSection with a short summary; set `defaultOpen={false}` for most. |
| `pages/Budgets.tsx` | Wrap "Budget Intelligence", "Auto Household Budget Engine", "Budget sharing", "Shared-budget transactions" in CollapsibleSection; keep Budget Overview cards as-is or only collapse the request list/table. |
| `pages/Investments.tsx` (Investment Plan tab) | Wrap execution result, proposed trades, and optionally universe/holdings tables in CollapsibleSection. |
| `pages/Summary.tsx` | If AI report is long, add "Show full report" that expands the rest of the content. |
| `pages/Goals.tsx` | Per goal card: add "Details" expand for linked assets and extra info. |
| `pages/Plan.tsx` | Optional: collapse monthly breakdown or category detail blocks. |
| `index.css` | Optional: utility class for collapse transition (e.g. `.collapsible-content`) if not using CSS-in-JS. |

---

## Part 4: Summary

- **UI/UX**: Clear hierarchy, consistent spacing and tokens, progressive disclosure, light theme, good empty/loading states and accessibility.
- **Expand/collapse**: One reusable **CollapsibleSection** component; use it on dense pages (Wealth Ultra, Budgets, Investment Plan, Summary, Goals, etc.) so that a **one-line summary** is visible when closed and **full details** when opened. Prefer **collapsed by default** and optional **persisted state** via `storageKey` for a better first-time and returning experience.
