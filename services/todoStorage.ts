import type { TodoItem } from '../types';
import { MAX_ATTACHMENTS_PER_TODO } from './todoAttachmentIdb';

const KEY_PREFIX = 'finova_todos_v1';

export function todosStorageKey(userId: string | undefined): string {
  const id = userId && userId.length > 0 ? userId : 'local';
  return `${KEY_PREFIX}_${id}`;
}

export function loadTodosFromStorage(key: string): TodoItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTodoShape);
  } catch {
    return [];
  }
}

export function saveTodosToStorage(key: string, todos: TodoItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(todos));
  } catch {
    /* quota */
  }
}

export function isTodoShape(x: unknown): x is TodoItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.id !== 'string' ||
    typeof o.title !== 'string' ||
    o.title.length === 0 ||
    (o.priority !== 'low' && o.priority !== 'medium' && o.priority !== 'high') ||
    (o.status !== 'open' && o.status !== 'completed') ||
    typeof o.createdAt !== 'string' ||
    typeof o.updatedAt !== 'string' ||
    typeof o.sortOrder !== 'number'
  ) {
    return false;
  }
  if (o.pinned !== undefined && typeof o.pinned !== 'boolean') return false;
  if (o.snoozedUntil !== undefined && typeof o.snoozedUntil !== 'string') return false;
  if (o.listId !== undefined && typeof o.listId !== 'string') return false;
  if (o.dueTime !== undefined && typeof o.dueTime !== 'string') return false;
  if (o.reminderMinutesBefore !== undefined && typeof o.reminderMinutesBefore !== 'number') return false;
  if (o.lastReminderNotifiedYmd !== undefined && typeof o.lastReminderNotifiedYmd !== 'string') return false;
  const rec = o.recurrence;
  if (rec !== undefined && rec !== 'none' && rec !== 'daily' && rec !== 'weekly' && rec !== 'monthly') return false;
  if (o.tags !== undefined) {
    if (!Array.isArray(o.tags) || !o.tags.every((x) => typeof x === 'string')) return false;
  }
  if (o.subtasks !== undefined) {
    if (!Array.isArray(o.subtasks)) return false;
    for (const s of o.subtasks) {
      if (!s || typeof s !== 'object') return false;
      const st = s as Record<string, unknown>;
      if (typeof st.id !== 'string' || typeof st.title !== 'string' || typeof st.done !== 'boolean') return false;
    }
  }
  if (o.attachments !== undefined) {
    if (!Array.isArray(o.attachments) || o.attachments.length > MAX_ATTACHMENTS_PER_TODO) return false;
    for (const a of o.attachments) {
      if (!a || typeof a !== 'object') return false;
      const am = a as Record<string, unknown>;
      if (typeof am.id !== 'string' || typeof am.name !== 'string' || typeof am.mimeType !== 'string') return false;
      if (typeof am.sizeBytes !== 'number' || typeof am.createdAt !== 'string') return false;
    }
  }
  return true;
}

/** Import from `{ finovaTodosExport: 1, todos: [...] }` or a raw array of task objects. */
export function parseTodosImportPayload(data: unknown): { todos: TodoItem[] } | null {
  if (Array.isArray(data)) {
    const todos = data.filter(isTodoShape);
    return todos.length ? { todos } : null;
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const raw = o.todos;
  if (!Array.isArray(raw)) return null;
  const todos = raw.filter(isTodoShape);
  return todos.length ? { todos } : null;
}

export function newTodoId(): string {
  try {
    return `td_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  } catch {
    return `td_${String(Math.random()).slice(2)}`;
  }
}
