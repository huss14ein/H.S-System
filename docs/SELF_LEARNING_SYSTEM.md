# Self-Learning System — Implementation Reference

This document describes the self-learning system implemented across the H.S-System application. The system learns from user behavior to personalize the UX (form defaults, hints, suggestions, navigation) without server sync.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        App (SelfLearningProvider)                 │
├─────────────────────────────────────────────────────────────────┤
│  Layout (useTrackPageVisit)     CommandPalette (getTopPages)     │
│  QuickActionsSidebar (getTopActions)                             │
├─────────────────────────────────────────────────────────────────┤
│  Forms: Transactions, Accounts, Assets, Liabilities, Budgets     │
│  InfoHint (hintId/hintPage)     Budgets (suggestion feedback)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              services/selfLearningEngine.ts                       │
│  localStorage: finova_self_learning_v1_<userId>_state             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Files

| File | Purpose |
|------|---------|
| `services/selfLearningEngine.ts` | Engine: storage, recording, queries |
| `context/SelfLearningContext.tsx` | React context, provider, hooks |
| `App.tsx` | Wraps app with `SelfLearningProvider` |

---

## 3. Storage & Limits

**Storage key:** `finova_self_learning_v1_<userId>_state` (or `anonymous` when logged out)

**Limits:**

| Data Type | Max Records |
|-----------|-------------|
| Page visits | 200 |
| Actions | 500 |
| Form defaults | 100 |
| Hint dismissals | 150 |
| Suggestion feedback | 200 |

**Hint cooldown:** 14 days — a dismissed hint is not shown again for 14 days (via `shouldShowHint`).

---

## 4. Engine API (`services/selfLearningEngine.ts`)

### Recording functions

| Function | Purpose |
|----------|---------|
| `recordPageVisit(userId, page, durationMs?)` | Call on page mount; pass duration on unmount |
| `recordAction(userId, actionId, page, context?)` | Button clicks, links, commands |
| `recordFormDefault(userId, formId, field, value)` | After successful form submit (new records only) |
| `recordHintDismissed(userId, hintId, page)` | When user closes an InfoHint |
| `recordSuggestionFeedback(userId, suggestionId, page, accepted)` | When user accepts or rejects a suggestion |

### Query functions

| Function | Purpose |
|----------|---------|
| `getLearnedDefault(userId, formId, field, minCount?)` | Learned default for a form field (default `minCount = 2`) |
| `shouldShowHint(userId, hintId, page?)` | `true` if hint was not recently dismissed |
| `getTopPages(userId, limit?)` | Most visited pages |
| `getTopActions(userId, page?, limit?)` | Most used actions (optionally filtered by page) |
| `getSuggestionAcceptanceRate(userId, suggestionId, page?)` | Acceptance rate (null if &lt; 3 samples) |
| `getExpertiseScore(userId)` | 0.2–0.9 from hint dismissals in last 90 days |

---

## 5. Context API (`context/SelfLearningContext.tsx`)

### Hook: `useSelfLearning()`

Returns a noop context when the provider is absent, so components can call it safely.

```ts
const {
  trackPageVisit,
  trackAction,
  trackFormDefault,
  trackHintDismissed,
  trackSuggestionFeedback,
  getLearnedDefault,
  shouldShowHint,
  getTopPages,
  getTopActions,
  getSuggestionAcceptanceRate,
  getExpertiseScore,
} = useSelfLearning();
```

### Hook: `useTrackPageVisit(page)`

Tracks page visit on mount and duration on unmount.

```tsx
// In Layout.tsx
useTrackPageVisit(activePage);
```

---

## 6. App Integration

**`App.tsx`** — Provider order (inside `AuthProvider` and `ToastProvider`):

```tsx
<SelfLearningProvider>
  <AiProvider>
    <DataProvider>
      ...
    </DataProvider>
  </AiProvider>
</SelfLearningProvider>
```

---

## 7. Component Integrations

### 7.1 Layout (`components/Layout.tsx`)

- Uses `useTrackPageVisit(activePage)` to record page visits and time spent.

### 7.2 CommandPalette (`components/CommandPalette.tsx`)

- Uses `getTopPages(5)` to reorder “Go to X” commands by most visited pages.
- Calls `trackAction` when a command is chosen:
  - `go-to-<Page>` for navigation
  - `safety-rules`, `liquidation`, `journal` for sub-pages
  - `open-advisor` for AI Advisor
  - `export-backup` for data export

### 7.3 QuickActionsSidebar (`components/QuickActionsSidebar.tsx`)

- Uses `getTopActions(undefined, 10)` to reorder quick actions by usage.
- Calls `trackAction(actionId, page)` when an action is clicked.
- Action IDs: `add-transaction`, `add-asset`, `log-trade`, `notes-ideas`.

### 7.4 InfoHint (`components/InfoHint.tsx`)

- Optional props: `hintId`, `hintPage`.
- When both are set, calls `trackHintDismissed(hintId, hintPage)` on:
  - Click outside (close)
  - Toggle off (clicking the ! button again)

---

## 8. Form Default Learning

Forms use `getLearnedDefault` for initial values and `trackFormDefault` after successful submit (new records only).

### 8.1 Transaction Modal (`pages/Transactions.tsx`)

| Form ID | Fields | Validation |
|---------|--------|------------|
| `transaction-add` | `accountId`, `type`, `category`, `budgetCategory` | `accountId` must exist in accounts; `category`/`budgetCategory` must be in allowed lists |

### 8.2 Account Modal (`pages/Accounts.tsx`)

| Form ID | Fields | Validation |
|---------|--------|------------|
| `account-add` | `type` | Must be one of: Checking, Savings, Credit, Investment |

### 8.3 Asset Modal (`pages/Assets.tsx`)

| Form ID | Fields | Validation |
|---------|--------|------------|
| `asset-add` | `type` | Must be one of: Sukuk, Property, Vehicle, Other |

### 8.4 Liability Modal (`pages/Liabilities.tsx`)

| Form ID | Fields | Validation |
|---------|--------|------------|
| `liability-add` | `type` | Must be one of: Credit Card, Loan, Personal Loan, Mortgage, Receivable |

### 8.5 Budget Modal (`pages/Budgets.tsx`)

| Form ID | Fields | Validation |
|---------|--------|------------|
| `budget-add` | `limitPeriod`, `tier` | `limitPeriod`: Monthly, Weekly, Daily, Yearly; `tier`: Core, Supporting, Optional |

---

## 9. InfoHint Wiring (hintId / hintPage)

Hints with `hintId` and `hintPage` record dismissals for self-learning.

### 9.1 Transactions

| hintId | hintPage | Label |
|-------|----------|-------|
| `transaction-date` | Transactions | Date |
| `transaction-amount` | Transactions | Amount |
| `transaction-description` | Transactions | Description |
| `transaction-account` | Transactions | Account |
| `transaction-category` | Transactions | Category |

### 9.2 Summary

| hintId | hintPage | Label |
|-------|----------|-------|
| `summary-personal-wealth` | Summary | Personal wealth total |

### 9.3 Liabilities

| hintId | hintPage | Label |
|-------|----------|-------|
| `liability-name` | Liabilities | Liability Name |
| `liability-type` | Liabilities | Type |

### 9.4 Accounts

| hintId | hintPage | Label |
|-------|----------|-------|
| `account-name` | Accounts | Account Name |
| `account-type` | Accounts | Type |

### 9.5 Assets

| hintId | hintPage | Label |
|-------|----------|-------|
| `asset-name` | Assets | Asset Name |
| `asset-type` | Assets | Asset Type |

---

## 10. Suggestion Feedback

### 10.1 Budget Suggested Adjustments (`pages/Budgets.tsx`)

- **Suggestion ID:** `budget-suggested-adjustments`
- **Page:** Budgets
- **Tracked when:**
  - User clicks “Apply all” → `trackSuggestionFeedback(..., true)`
  - User clicks “Cancel” or closes modal → `trackSuggestionFeedback(..., false)`

---

## 11. Data Structures

```ts
interface PageVisitRecord {
  page: Page;
  ts: number;
  durationMs?: number;
}

interface ActionRecord {
  actionId: ActionId;
  page: Page;
  context?: string;
  ts: number;
}

interface FormDefaultRecord {
  formId: string;
  field: string;
  value: unknown;
  ts: number;
  count: number;
}

interface HintDismissalRecord {
  hintId: string;
  page: Page;
  ts: number;
}

interface SuggestionFeedbackRecord {
  suggestionId: string;
  page: Page;
  accepted: boolean;
  ts: number;
}
```

---

## 12. Extending the System

### Adding form default learning

1. In the form’s `useEffect` (when opening for a new record), call `getLearnedDefault(formId, field)` and validate the value.
2. After successful submit (new record only), call `trackFormDefault(formId, field, value)` for each learned field.

### Adding hint tracking

1. Add `hintId` and `hintPage` props to the `InfoHint` component.
2. Use `shouldShowHint(hintId, hintPage)` if you want to hide the hint entirely during cooldown (optional).

### Adding suggestion feedback

1. Where the user accepts or rejects a suggestion, call `trackSuggestionFeedback(suggestionId, page, accepted)`.
2. Use `getSuggestionAcceptanceRate` to rank or filter suggestions (requires ≥ 3 samples).

### Adding action tracking

1. Where the user performs an action (button, link, command), call `trackAction(actionId, page)`.
2. Use `getTopActions` to reorder shortcuts or quick actions.

---

## 13. Notes

- **No server sync:** All data is stored in `localStorage` only.
- **User-scoped:** Data is keyed by `userId` from `AuthContext`; anonymous users use `anonymous`.
- **TransactionAIContext:** The existing `learnFromCorrections` for category rules is separate and complementary to this system.
- **Noop fallback:** `useSelfLearning()` returns a noop context when the provider is absent, so components can call it safely.
