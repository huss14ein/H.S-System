# Charts & graphs – design system

All charts in the app should be **consistent**, **accessible**, and **well-tracked** (empty states, loading where needed). Use the shared theme and components below.

## Theme (`components/charts/chartTheme.ts`)

- **CHART_COLORS**: `categorical` (pie/bar series), `positive` (income/gain), `negative` (expense/loss), `primary`, `secondary`, `tertiary`, `liability`, `grid`, `axis`.
- **CHART_MARGIN**: Default Recharts margin.
- **CHART_GRID_STROKE** / **CHART_GRID_COLOR**: CartesianGrid style.
- **CHART_AXIS_COLOR** / **CHART_AXIS_FONT_SIZE**: Axis stroke and tick font.
- **formatAxisNumber(value)**: Compact Y-axis formatter (e.g. 1.2K, 3.5M).

## Components

### ChartContainer

Wrap chart content for consistent height and **empty state**:

```tsx
<ChartContainer height={300} isEmpty={!data?.length} emptyMessage="No data to display.">
  <ResponsiveContainer width="100%" height="100%">
    <BarChart ... />
  </ResponsiveContainer>
</ChartContainer>
```

### ChartTooltip (optional)

Use for custom tooltip content with consistent styling (see `ChartTooltip.tsx`). Recharts `Tooltip` should use:

- **contentStyle**: `backgroundColor: 'white'`, `border: '1px solid #e2e8f0'`, `borderRadius: '12px'`, `boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'`, `padding: '10px 14px'`.

## Currency in tooltips

- Use **useFormatCurrency** and **formatCurrencyString** for all monetary tooltip values so currency respects user settings (SAR/USD).
- Do not hardcode "SAR" or "USD" in chart tooltips.

## Rules

1. **Colors**: Use `CHART_COLORS` from theme (e.g. income = positive, expenses = negative, allocation = categorical).
2. **Grid & axes**: Use `CHART_GRID_STROKE`, `CHART_GRID_COLOR`, `CHART_AXIS_COLOR`, and `formatAxisNumber` for Y-axis.
3. **Empty state**: Use `ChartContainer` with `isEmpty` and `emptyMessage` when there is no data.
4. **Tooltips**: Rounded (12px), border, light shadow; format currency via `formatCurrencyString`.
5. **Legend**: Prefer `iconType="circle"`, `iconSize={8}`, `wrapperStyle={{ fontSize: 12 }}` for consistency.

## Where charts live

- **Shared components**: `components/charts/` (CashflowChart, NetWorthCompositionChart, ExpenseBreakdownChart, PerformanceTreemap, MiniPriceChart, AllocationPieChart, AllocationBarChart).
- **Page-level**: Analysis (SpendingByCategory, IncomeExpenseTrend, AssetLiability), Forecast, Plan, DividendTrackerView, etc.

When adding a new chart, import from `chartTheme` and use `ChartContainer` + `formatCurrencyString` for tooltips.
