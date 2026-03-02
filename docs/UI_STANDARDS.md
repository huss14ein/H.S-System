# H.S System – UI/UX standards

Use these patterns so all pages look and behave consistently.

## Page structure

- **PageLayout** (`components/PageLayout.tsx`): Wraps the page with a title, optional description, and optional action (e.g. "Add" button). Use for every main app page.
- **Page container**: The root of page content uses the `page-container` class (or PageLayout, which applies it). Spacing between sections: `space-y-8`.

## Drag-and-drop and resizable grids

- **DraggableResizableGrid** (`components/DraggableResizableGrid.tsx`): Use for any page that wants components (cards, sections) to be **draggable** and **resizable** with no extra buttons. Users drag items to reorder and resize by the corner handle.
- **Centralized and standard**: One component, one persistence key per grid. Layout is stored in `localStorage` under `rgl-{layoutKey}` so it is remembered across sessions.
- **Usage**: Import `DraggableResizableGrid`, pass a unique `layoutKey` (e.g. `"dashboard-kpi"`, `"assets-summary"`) and an `items` array of `{ id, content, defaultW?, defaultH?, minW?, minH? }`. Grid is 12 columns; `defaultW`/`defaultH` are in grid units. Drag anywhere on the item to move; use the resize handle on the bottom-right to resize.
- **Where used**: Dashboard (KPI cards), Assets (summary cards). Use the same pattern on Budgets, Summary, or any page with a set of cards/sections you want reorderable and resizable.

## Metric boxes and card labels

- **Single-line labels/values**: Use `.metric-label` and `.metric-value` (in `index.css`) on any small box or table cell where the text must stay on one line. They apply `white-space: nowrap`, `overflow: hidden`, and `text-overflow: ellipsis` so labels like "Available Cash" or "Unrealized P/L" never wrap to two lines (e.g. "AVAILABL E CASH"). Use on platform metric boxes, holding details, dashboard cards, and similar areas across all pages.

## Content blocks

- **SectionCard** (`components/SectionCard.tsx`): Main content blocks. Use for:
  - Recurring rules, admin queue, transaction history, expense breakdown, etc.
  - Use `section-card` class for static blocks, or the `SectionCard` component with optional `title`, `headerAction`, and `onClick` for clickable blocks.
- **CSS classes** (in `index.css`):
  - `.section-card` – white card, rounded-xl, shadow, border, padding
  - `.section-card-hover` – same + hover lift; use for clickable cards
  - `.section-title` – section heading (text-lg font-semibold text-dark, with optional icon)

## Buttons

- `.btn-primary` – main actions (Add, Save, Submit)
- `.btn-secondary` – alternate primary (e.g. violet)
- `.btn-ghost` – secondary actions (Cancel, filters)
- `.btn-outline` – outlined primary (e.g. "Add recurring")
- `.btn-danger` – destructive (Delete, Reject)
- All buttons use `rounded-xl`, focus rings, and disabled states.

## Forms

- `.input-base` – text/number inputs
- `.select-base` – dropdowns
- Labels: `block text-sm font-medium text-gray-700 mb-1`

## Feedback

- `.empty-state` – centered muted text when there’s no data
- `.alert-error`, `.alert-warning`, `.alert-info` – left-border alerts
- `.badge-success`, `.badge-warning`, `.badge-danger`, `.badge-neutral` – status pills

## Lists

- `.list-row` – list item with padding, hover, and border between rows. Use for transaction rows, recurring rules, etc.

## Modals

- Use `Modal` component; it has consistent rounded-xl, padding, and a focusable close button with `aria-label="Close"`.

## Accessibility

- Clickable non-buttons: `role="button"`, `tabIndex={0}`, `onKeyDown` for Enter.
- Icon buttons: `aria-label` (e.g. "Edit", "Delete", "Close").
- Form controls: associate labels with inputs (e.g. `htmlFor` / `id`).

## Charts & graphs

- Use the **chart theme** and **ChartContainer** from `components/charts/` so all graphs look consistent. See **docs/CHARTS.md** for colors, tooltips, empty states, and currency formatting in charts.

## Investment plan execution

- **Execute & View Results** (Investments → Plan): Uses AI when available; if the AI service is unavailable (e.g. quota), results are **automatically computed with rule-based logic** so execution always returns a plan. Users can also click **Run rule-based only** to skip AI. Rule-based allocation uses plan weights (Core / High-Upside / Speculative) and broker constraints; audit log is marked "Rule-based execution (no AI)".

## Performance & security

- Avoid inline styles; use Tailwind and the design tokens above.
- Sensitive actions (delete, approve) should use confirmation modals where appropriate.
- Keep form state local; submit only on explicit Save/Submit.
