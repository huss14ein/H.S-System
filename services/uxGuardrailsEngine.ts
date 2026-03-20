/**
 * UX and usability helper engines (logic layer).
 *
 * These provide consistent hints/status labels and workflow shortcuts.
 * UI components can use these for standardized microcopy.
 */

export type BadgeSeverity = 'success' | 'warning' | 'danger' | 'info';

export function fieldHintEngine(args: {
  field: string;
  context?: Record<string, unknown>;
}): string | null {
  const f = args.field.toLowerCase();
  if (f.includes('amount')) return 'Enter a positive amount. Negative values may be rejected.';
  if (f.includes('date')) return 'Use a valid date format (YYYY-MM-DD).';
  if (f.includes('symbol')) return 'Use the ticker/symbol exactly as listed in your portfolio universe.';
  if (f.includes('ratio') || f.includes('percent')) return 'Provide a numeric percentage (e.g. 3.5 for 3.5%).';
  return null;
}

export function statusBadgeEngine(args: {
  status: string;
}): { text: string; severity: BadgeSeverity } {
  const s = args.status.toLowerCase();
  if (s.includes('healthy') || s.includes('on track')) return { text: args.status, severity: 'success' };
  if (s.includes('low') || s.includes('near') || s.includes('warning') || s.includes('adequate')) return { text: args.status, severity: 'warning' };
  if (s.includes('critical') || s.includes('risk') || s.includes('over') || s.includes('blocked')) return { text: args.status, severity: 'danger' };
  return { text: args.status, severity: 'info' };
}

export function userInputGuard(args: {
  field: string;
  value: unknown;
}): { ok: boolean; error?: string } {
  const field = args.field.toLowerCase();
  if (field.includes('amount')) {
    const n = Number(args.value);
    if (!Number.isFinite(n)) return { ok: false, error: 'Amount must be a number.' };
    if (n < 0) return { ok: false, error: 'Amount cannot be negative.' };
  }
  if (field.includes('quantity')) {
    const n = Number(args.value);
    if (!Number.isFinite(n)) return { ok: false, error: 'Quantity must be a number.' };
    if (n <= 0) return { ok: false, error: 'Quantity must be greater than 0.' };
  }
  return { ok: true };
}

export interface WorkflowShortcut {
  id: string;
  title: string;
  hint?: string;
}

export function workflowShortcutMenu(args: {
  shortcuts: Partial<WorkflowShortcut>[];
}): WorkflowShortcut[] {
  return (args.shortcuts ?? []).map((s, idx) => ({
    id: s.id ?? `wf-${idx + 1}`,
    title: String(s.title ?? 'Untitled'),
    hint: s.hint ? String(s.hint) : undefined,
  }));
}

