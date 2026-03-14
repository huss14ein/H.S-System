# Plan: Unified Light Theme and UI

## Goal
Make the system theme and UI **unified and light**: one consistent light theme across the app, with no dark hero/header bands and a single design language for page headers, cards, and controls.

## Current State
- **Global**: Body and Layout are already light (`bg-light`, `from-slate-50 to-slate-100`). Header is white with dark text. Design tokens exist in `tailwind.config.js` and `index.css` (`.section-card`, `.page-title`, `.btn-primary`, etc.).
- **Inconsistencies**:
  - **Investments page** uses two **dark** hero sections (slate-900/800 gradients, white text):
    1. Main page header: “Investments” title, description, “Smart Plan” / “Record Trade” buttons.
    2. Investment Plan tab: “Monthly Core + Analyst-Upside Sleeve Strategy” section header.
  - **MiniPriceChart** tooltip uses dark styling (`bg-gray-900 text-white`).
- **Other pages**: Use light backgrounds and dark text; only primary/secondary buttons use white text (correct).

## Approach

### 1. Define a shared “page hero” (light) in CSS
- **File**: `index.css`
- Add a class such as `.page-hero` (or `.page-header-light`) that:
  - Uses a light background (e.g. `bg-white` or `bg-gradient-to-br from-slate-50 to-white`).
  - Uses dark text (`text-dark` or `text-slate-800`).
  - Reuses existing borders/shadows (e.g. `border border-slate-200 rounded-2xl shadow-sm`) so it matches `.section-card` and the rest of the app.
- Use this class for any page-level or section-level hero so all headers look the same.

### 2. Replace dark heroes on Investments page
- **File**: `pages/Investments.tsx`
- **Main Investments header** (around lines 2646–2671):
  - Replace `bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900` with the new light hero class (or equivalent: e.g. `bg-gradient-to-br from-slate-50 to-white` + `border border-slate-200`).
  - Change title from `text-white` to `text-dark` (or `text-slate-800`).
  - Change description from `text-slate-200/90` to `text-slate-600` (or `text-slate-500`).
  - Badges: replace `bg-white/10`, `text-slate-100`, `text-emerald-100`, `text-amber-100` with light-appropriate variants (e.g. `bg-slate-100 text-slate-700`, `bg-emerald-100 text-emerald-800`, `bg-amber-100 text-amber-800`).
  - “Smart Plan” button: replace `border-white/30 bg-white/10 text-white hover:bg-white/20` with a light secondary style (e.g. `border-slate-200 bg-white text-slate-700 hover:bg-slate-50` or `btn-ghost`), and keep “Record Trade” as primary (`bg-primary text-white`) or same as current white button.
  - Ensure `LivePricesStatus` and any icons use dark/muted colors (e.g. `text-slate-600`) instead of `text-slate-100`.
- **Investment Plan section header** (around lines 1956–1964):
  - Replace the same dark gradient with the light hero class.
  - Title: `text-dark` (or `text-slate-800`) instead of `text-white`.
  - “Save Plan” button: already light (`bg-white text-slate-900`); keep or align with `.btn-outline`/`.btn-ghost` for consistency.

### 3. Unify tab strip below hero
- The tab strip on Investments (lines 2717–2735) is already light (`bg-white`, inactive `text-slate-500`, active `bg-primary text-white`). No change needed other than ensuring the hero above it is light so the transition is consistent.

### 4. MiniPriceChart tooltip
- **File**: `components/charts/MiniPriceChart.tsx`
- Replace tooltip container from `bg-gray-900 text-white` to a light style, e.g.:
  - `bg-white border border-slate-200 text-slate-800 shadow-lg` (and keep `text-xs`, `px-2`, `py-1`, `rounded`).

### 5. Document theme in UI standards
- **File**: `docs/UI_STANDARDS.md`
- Add a **Theme** section:
  - The app uses a **single light theme**.
  - Page and section headers use a light “hero” style (no dark bands): use `.page-hero` for consistency.
  - Cards: `.section-card`; titles: `.page-title` / `.section-title`; buttons: `.btn-primary`, `.btn-secondary`, `.btn-ghost`, etc.
  - Reserve white-on-dark only for primary/secondary/danger buttons and small badges where the design system explicitly uses it.

## Files to Touch
| File | Action |
|------|--------|
| `index.css` | Add `.page-hero` (light background, dark text, border, rounded). |
| `pages/Investments.tsx` | Replace both dark hero sections and their inner text/button styles with light hero + dark text and unified button styles. |
| `components/charts/MiniPriceChart.tsx` | Change tooltip to light (white bg, border, dark text). |
| `docs/UI_STANDARDS.md` | Add Theme section (light-only, page-hero, no dark heroes). |

## Verification
- Run the app and open **Investments** and **Investment Plan** tab: both headers should be light with dark text and no white-on-dark blocks.
- Hover a mini price chart: tooltip should be light.
- Quick visual pass: no remaining `from-slate-900` / `via-slate-800` / `to-slate-900` or large `bg-gray-900`/`bg-slate-900` areas; only buttons and small accents may use dark bg + white text.

## Optional (later)
- If other pages add custom headers, use `.page-hero` from the start.
- Consider a single CSS variable for “page hero background” (e.g. `--page-hero-bg`) in `index.css` so future theme tweaks are one-place.
