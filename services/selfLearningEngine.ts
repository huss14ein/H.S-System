/**
 * Self-learning engine: learns from user behavior to personalize UX across all pages.
 * Persists to localStorage (keyed by user id). No server sync.
 */

const STORAGE_KEY_PREFIX = 'finova_self_learning_v1';
const MAX_PAGE_VISITS = 200;
const MAX_ACTIONS = 500;
const MAX_FORM_DEFAULTS = 100;
const MAX_HINT_DISMISSALS = 150;
const MAX_SUGGESTION_FEEDBACK = 200;
const HINT_COOLDOWN_DAYS = 14; // Don't show hint again for 14 days after dismiss

export type Page = string;
export type ActionId = string;

export interface PageVisitRecord {
  page: Page;
  ts: number;
  durationMs?: number;
}

export interface ActionRecord {
  actionId: ActionId;
  page: Page;
  context?: string;
  ts: number;
}

export interface FormDefaultRecord {
  formId: string;
  field: string;
  value: unknown;
  ts: number;
  count: number;
}

export interface HintDismissalRecord {
  hintId: string;
  page: Page;
  ts: number;
}

export interface SuggestionFeedbackRecord {
  suggestionId: string;
  page: Page;
  accepted: boolean;
  ts: number;
}

export interface SelfLearningState {
  pageVisits: PageVisitRecord[];
  actions: ActionRecord[];
  formDefaults: FormDefaultRecord[];
  hintDismissals: HintDismissalRecord[];
  suggestionFeedback: SuggestionFeedbackRecord[];
  lastUpdated: number;
}

function getStorageKey(userId: string | undefined, suffix: string): string {
  const uid = userId || 'anonymous';
  return `${STORAGE_KEY_PREFIX}_${uid}_${suffix}`;
}

function loadState(userId: string | undefined): SelfLearningState {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(getStorageKey(userId, 'state'))
      : null;
    if (raw) {
      const parsed = JSON.parse(raw) as SelfLearningState;
      return {
        pageVisits: parsed.pageVisits ?? [],
        actions: parsed.actions ?? [],
        formDefaults: parsed.formDefaults ?? [],
        hintDismissals: parsed.hintDismissals ?? [],
        suggestionFeedback: parsed.suggestionFeedback ?? [],
        lastUpdated: parsed.lastUpdated ?? 0,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return {
    pageVisits: [],
    actions: [],
    formDefaults: [],
    hintDismissals: [],
    suggestionFeedback: [],
    lastUpdated: 0,
  };
}

function saveState(userId: string | undefined, state: SelfLearningState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const toSave = {
      ...state,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(getStorageKey(userId, 'state'), JSON.stringify(toSave));
  } catch {
    // Ignore quota errors
  }
}

/** Record a page visit. Call on page mount. */
export function recordPageVisit(
  userId: string | undefined,
  page: Page,
  durationMs?: number
): void {
  const state = loadState(userId);
  const record: PageVisitRecord = { page, ts: Date.now(), durationMs };
  state.pageVisits = [record, ...state.pageVisits].slice(0, MAX_PAGE_VISITS);
  saveState(userId, state);
}

/** Record an action (button click, link, etc.). */
export function recordAction(
  userId: string | undefined,
  actionId: ActionId,
  page: Page,
  context?: string
): void {
  const state = loadState(userId);
  state.actions = [
    { actionId, page, context, ts: Date.now() },
    ...state.actions,
  ].slice(0, MAX_ACTIONS);
  saveState(userId, state);
}

/** Record a form submission to learn default values. */
export function recordFormDefault(
  userId: string | undefined,
  formId: string,
  field: string,
  value: unknown
): void {
  const state = loadState(userId);
  const existing = state.formDefaults.find(
    (f) => f.formId === formId && f.field === field
  );
  if (existing) {
    existing.value = value;
    existing.ts = Date.now();
    existing.count += 1;
  } else {
    state.formDefaults = [
      { formId, field, value, ts: Date.now(), count: 1 },
      ...state.formDefaults,
    ].slice(0, MAX_FORM_DEFAULTS);
  }
  saveState(userId, state);
}

/** Record hint dismissal. Used to avoid showing same hint repeatedly. */
export function recordHintDismissed(
  userId: string | undefined,
  hintId: string,
  page: Page
): void {
  const state = loadState(userId);
  state.hintDismissals = [
    { hintId, page, ts: Date.now() },
    ...state.hintDismissals,
  ].slice(0, MAX_HINT_DISMISSALS);
  saveState(userId, state);
}

/** Record suggestion feedback (accepted or rejected). */
export function recordSuggestionFeedback(
  userId: string | undefined,
  suggestionId: string,
  page: Page,
  accepted: boolean
): void {
  const state = loadState(userId);
  state.suggestionFeedback = [
    { suggestionId, page, accepted, ts: Date.now() },
    ...state.suggestionFeedback,
  ].slice(0, MAX_SUGGESTION_FEEDBACK);
  saveState(userId, state);
}

/** Get learned default for a form field. Returns undefined if no strong signal. */
export function getLearnedDefault(
  userId: string | undefined,
  formId: string,
  field: string,
  minCount = 2
): unknown {
  const state = loadState(userId);
  const match = state.formDefaults.find(
    (f) => f.formId === formId && f.field === field && f.count >= minCount
  );
  return match?.value;
}

/** Check if a hint should be shown (not recently dismissed). */
export function shouldShowHint(
  userId: string | undefined,
  hintId: string,
  page?: Page
): boolean {
  const state = loadState(userId);
  const cutoff = Date.now() - HINT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const recent = state.hintDismissals.filter(
    (h) =>
      h.hintId === hintId &&
      h.ts > cutoff &&
      (page == null || h.page === page)
  );
  return recent.length === 0;
}

/** Get most frequently visited pages (for quick nav, landing suggestions). */
export function getTopPages(
  userId: string | undefined,
  limit = 5
): { page: Page; count: number }[] {
  const state = loadState(userId);
  const counts = new Map<Page, number>();
  for (const v of state.pageVisits) {
    counts.set(v.page, (counts.get(v.page) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([page, count]) => ({ page, count }));
}

/** Get most used actions (for surfacing shortcuts). */
export function getTopActions(
  userId: string | undefined,
  page?: Page,
  limit = 5
): { actionId: ActionId; count: number }[] {
  const state = loadState(userId);
  const filtered = page
    ? state.actions.filter((a) => a.page === page)
    : state.actions;
  const counts = new Map<ActionId, number>();
  for (const a of filtered) {
    counts.set(a.actionId, (counts.get(a.actionId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([actionId, count]) => ({ actionId, count }));
}

/** Get acceptance rate for a suggestion (for ranking). */
export function getSuggestionAcceptanceRate(
  userId: string | undefined,
  suggestionId: string,
  page?: Page
): number | null {
  const state = loadState(userId);
  const filtered = state.suggestionFeedback.filter(
    (s) =>
      s.suggestionId === suggestionId &&
      (page == null || s.page === page)
  );
  if (filtered.length < 3) return null;
  const accepted = filtered.filter((s) => s.accepted).length;
  return accepted / filtered.length;
}

/** Infer expertise level from hint dismissals (more dismissals = more experienced). */
export function getExpertiseScore(userId: string | undefined): number {
  const state = loadState(userId);
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days
  const recent = state.hintDismissals.filter((h) => h.ts > cutoff);
  if (recent.length >= 20) return 0.9;
  if (recent.length >= 10) return 0.7;
  if (recent.length >= 5) return 0.5;
  return 0.2;
}
