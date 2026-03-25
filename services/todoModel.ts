import type { TodoItem, TodoPriority } from '../types';

const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 3, medium: 2, low: 1 };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Task is hidden from due/overdue buckets until this calendar day (start of day). */
export function isTaskSnoozed(t: TodoItem, todayYmd: string): boolean {
  if (t.status !== 'open') return false;
  const s = t.snoozedUntil;
  if (!s || !DAY.test(s)) return false;
  return todayYmd < s;
}

/** Open tasks that are not currently snoozed. */
export function isOpenActionable(t: TodoItem, todayYmd: string): boolean {
  return t.status === 'open' && !isTaskSnoozed(t, todayYmd);
}

export function computeTaskCounts(todos: TodoItem[], todayYmd: string): {
  active: number;
  overdue: number;
  dueToday: number;
  snoozed: number;
} {
  let active = 0;
  let overdue = 0;
  let dueToday = 0;
  let snoozed = 0;
  for (const t of todos) {
    if (t.status !== 'open') continue;
    active++;
    if (isTaskSnoozed(t, todayYmd)) {
      snoozed++;
      continue;
    }
    if (!t.dueDate) continue;
    if (t.dueDate < todayYmd) overdue++;
    else if (t.dueDate === todayYmd) dueToday++;
  }
  return { active, overdue, dueToday, snoozed };
}

export function addCalendarDaysYmd(ymd: string, days: number): string {
  if (!DAY.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Sort open actionable tasks: pinned → due date → priority → sortOrder. */
export function compareActionableTodos(a: TodoItem, b: TodoItem): number {
  const ap = a.pinned ? 1 : 0;
  const bp = b.pinned ? 1 : 0;
  if (bp !== ap) return bp - ap;
  const da = a.dueDate ?? '9999-12-31';
  const db = b.dueDate ?? '9999-12-31';
  if (da !== db) return da.localeCompare(db);
  const pa = PRIORITY_ORDER[a.priority];
  const pb = PRIORITY_ORDER[b.priority];
  if (pb !== pa) return pb - pa;
  return a.sortOrder - b.sortOrder;
}
