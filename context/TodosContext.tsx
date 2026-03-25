import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Page, TodoItem, TodoPriority, TodoStatus, TodoRecurrence, TodoAttachmentMeta } from '../types';
import { AuthContext } from './AuthContext';
import { isTodoShape, loadTodosFromStorage, newTodoId, saveTodosToStorage, todosStorageKey } from '../services/todoStorage';
import { computeTaskCounts } from '../services/todoModel';
import { isValidDueTime, nextDueDateForRecurrence } from '../services/todoRecurrence';
import {
  deleteAllAttachmentsForTodo,
  deleteTodoAttachmentBlob,
  isIndexedDbAvailable,
  MAX_ATTACHMENTS_PER_TODO,
  MAX_TODO_ATTACHMENT_BYTES,
  putTodoAttachmentBlob,
} from '../services/todoAttachmentIdb';

function normalizeTags(raw: string[] | undefined): string[] | undefined {
  if (!raw?.length) return undefined;
  const out = [...new Set(raw.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 24);
  return out.length ? out : undefined;
}

function clampReminder(m: number | undefined): number | undefined {
  if (m == null || !Number.isFinite(m)) return undefined;
  return Math.max(0, Math.min(10080, Math.round(m)));
}

function normalizeAttachmentList(raw: TodoAttachmentMeta[] | undefined): TodoAttachmentMeta[] | undefined {
  if (!raw?.length) return undefined;
  const out = raw.slice(0, MAX_ATTACHMENTS_PER_TODO).map((a) => ({
    id: a.id,
    name: String(a.name).trim().slice(0, 240),
    mimeType: String(a.mimeType).trim().slice(0, 120) || 'application/octet-stream',
    sizeBytes: Math.max(0, Math.floor(Number(a.sizeBytes) || 0)),
    createdAt: a.createdAt,
  }));
  return out.length ? out : undefined;
}

export type AddTodoInput = {
  title: string;
  notes?: string;
  priority?: TodoPriority;
  dueDate?: string;
  dueTime?: string;
  reminderMinutesBefore?: number;
  recurrence?: TodoRecurrence;
  pinned?: boolean;
  listId?: string;
  tags?: string[];
  subtasks?: { id: string; title: string; done: boolean }[];
  attachments?: TodoAttachmentMeta[];
  linkedPage?: Page;
  sourceNotificationId?: string;
};

export type TodosContextValue = {
  todos: TodoItem[];
  storageKey: string;
  activeCount: number;
  overdueCount: number;
  dueTodayCount: number;
  snoozedCount: number;
  addTodo: (input: AddTodoInput) => TodoItem;
  updateTodo: (
    id: string,
    patch: Partial<
      Pick<
        TodoItem,
        | 'title'
        | 'notes'
        | 'priority'
        | 'dueDate'
        | 'dueTime'
        | 'reminderMinutesBefore'
        | 'recurrence'
        | 'lastReminderNotifiedYmd'
        | 'linkedPage'
        | 'status'
        | 'sortOrder'
        | 'pinned'
        | 'snoozedUntil'
        | 'listId'
        | 'tags'
        | 'subtasks'
        | 'attachments'
      >
    >,
  ) => void;
  attachFileToTodo: (todoId: string, file: File) => Promise<{ ok: boolean; error?: string }>;
  removeAttachmentFromTodo: (todoId: string, attachmentId: string) => Promise<void>;
  deleteTodo: (id: string) => TodoItem | null;
  restoreTodo: (item: TodoItem) => void;
  toggleComplete: (id: string) => void;
  clearCompleted: () => void;
  reorderTodo: (id: string, direction: 'up' | 'down') => void;
  bulkCompleteTodos: (ids: string[]) => void;
  bulkDeleteTodos: (ids: string[]) => TodoItem[];
  /** Replace all tasks (used for JSON import). Persists immediately via existing effect. */
  importTodosReplace: (items: TodoItem[]) => void;
  createFromNotification: (args: { id: string; message: string; pageLink: Page }) => TodoItem | null;
};

const TodosContext = createContext<TodosContextValue | null>(null);

function isoToday(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function TodosProvider({ children }: { children: React.ReactNode }) {
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id;
  const key = useMemo(() => todosStorageKey(userId), [userId]);

  const [todos, setTodos] = useState<TodoItem[]>(() => loadTodosFromStorage(key));
  const todosRef = useRef(todos);
  todosRef.current = todos;

  useEffect(() => {
    setTodos(loadTodosFromStorage(key));
  }, [key]);

  useEffect(() => {
    saveTodosToStorage(key, todos);
  }, [key, todos]);

  const addTodo = useCallback((input: AddTodoInput): TodoItem => {
    const now = new Date().toISOString();
    const newId = newTodoId();
    const dueT = input.dueTime && isValidDueTime(input.dueTime) ? input.dueTime.trim() : undefined;
    const rec = input.recurrence && input.recurrence !== 'none' ? input.recurrence : undefined;
    const list = input.listId?.trim() ? input.listId.trim().slice(0, 64) : undefined;
    let added!: TodoItem;
    setTodos((prev) => {
      const maxOrder = prev.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      added = {
        id: newId,
        title: input.title.trim().slice(0, 500),
        notes: input.notes?.trim() ? input.notes.trim().slice(0, 5000) : undefined,
        priority: input.priority ?? 'medium',
        status: 'open',
        pinned: !!input.pinned,
        dueDate: input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : undefined,
        dueTime: dueT,
        reminderMinutesBefore: clampReminder(input.reminderMinutesBefore),
        recurrence: rec,
        listId: list,
        tags: normalizeTags(input.tags),
        subtasks: input.subtasks?.length
          ? input.subtasks.map((s) => ({
              id: s.id || `st_${newTodoId()}`,
              title: String(s.title).trim().slice(0, 300),
              done: !!s.done,
            }))
          : undefined,
        attachments: normalizeAttachmentList(input.attachments),
        linkedPage: input.linkedPage,
        sourceNotificationId: input.sourceNotificationId,
        createdAt: now,
        updatedAt: now,
        sortOrder: maxOrder + 1,
      };
      return [...prev, added];
    });
    return added;
  }, []);

  const updateTodo = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          TodoItem,
          | 'title'
          | 'notes'
          | 'priority'
          | 'dueDate'
          | 'dueTime'
          | 'reminderMinutesBefore'
          | 'recurrence'
          | 'lastReminderNotifiedYmd'
          | 'linkedPage'
          | 'status'
          | 'sortOrder'
          | 'pinned'
          | 'snoozedUntil'
          | 'listId'
          | 'tags'
          | 'subtasks'
          | 'attachments'
        >
      >,
    ) => {
      const now = new Date().toISOString();
      setTodos((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const next: TodoItem = {
            ...t,
            ...patch,
            updatedAt: now,
          };
          if (patch.status === 'completed' && t.status !== 'completed') {
            next.completedAt = now;
          }
          if (patch.status === 'open') {
            next.completedAt = undefined;
          }
          if (patch.title != null) next.title = patch.title.trim().slice(0, 500);
          if (patch.notes !== undefined) next.notes = patch.notes?.trim() ? patch.notes.trim().slice(0, 5000) : undefined;
          if (patch.dueDate !== undefined) {
            next.dueDate = patch.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate) ? patch.dueDate : undefined;
          }
          if (patch.dueTime !== undefined) {
            next.dueTime = patch.dueTime && isValidDueTime(patch.dueTime) ? patch.dueTime.trim() : undefined;
          }
          if (patch.reminderMinutesBefore !== undefined) {
            next.reminderMinutesBefore = clampReminder(patch.reminderMinutesBefore);
          }
          if (patch.recurrence !== undefined) {
            next.recurrence = patch.recurrence === 'none' ? undefined : patch.recurrence;
          }
          if (patch.lastReminderNotifiedYmd !== undefined) {
            next.lastReminderNotifiedYmd =
              patch.lastReminderNotifiedYmd && /^\d{4}-\d{2}-\d{2}$/.test(patch.lastReminderNotifiedYmd)
                ? patch.lastReminderNotifiedYmd
                : undefined;
          }
          if (patch.pinned !== undefined) next.pinned = !!patch.pinned;
          if (patch.snoozedUntil !== undefined) {
            next.snoozedUntil =
              patch.snoozedUntil && /^\d{4}-\d{2}-\d{2}$/.test(patch.snoozedUntil) ? patch.snoozedUntil : undefined;
          }
          if (patch.listId !== undefined) {
            next.listId = patch.listId?.trim() ? patch.listId.trim().slice(0, 64) : undefined;
          }
          if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
          if (patch.subtasks !== undefined) {
            next.subtasks = patch.subtasks.map((s) => ({
              id: s.id || newTodoId(),
              title: String(s.title).trim().slice(0, 300),
              done: !!s.done,
            }));
          }
          return next;
        }),
      );
    },
    [],
  );

  const deleteTodo = useCallback((id: string): TodoItem | null => {
    let removed: TodoItem | null = null;
    setTodos((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t) removed = { ...t };
      return prev.filter((x) => x.id !== id);
    });
    if (removed) void deleteAllAttachmentsForTodo(id);
    return removed;
  }, []);

  const restoreTodo = useCallback((item: TodoItem) => {
    setTodos((prev) => {
      if (prev.some((t) => t.id === item.id)) return prev;
      return [...prev, item].sort((a, b) => a.sortOrder - b.sortOrder);
    });
  }, []);

  const toggleComplete = useCallback((id: string) => {
    setTodos((prev) => {
      const now = new Date().toISOString();
      return prev.map((t) => {
        if (t.id !== id) return t;
        if (t.status === 'completed') {
          return { ...t, status: 'open' as TodoStatus, completedAt: undefined, updatedAt: now };
        }
        const rec = t.recurrence;
        if (rec && rec !== 'none' && t.dueDate) {
          const nextDue = nextDueDateForRecurrence(t.dueDate, rec);
          return {
            ...t,
            dueDate: nextDue,
            subtasks: (t.subtasks ?? []).map((s) => ({ ...s, done: false })),
            lastReminderNotifiedYmd: undefined,
            updatedAt: now,
          };
        }
        return { ...t, status: 'completed' as TodoStatus, completedAt: now, updatedAt: now };
      });
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setTodos((prev) => prev.filter((t) => t.status !== 'completed'));
  }, []);

  const reorderTodo = useCallback((id: string, direction: 'up' | 'down') => {
    setTodos((prev) => {
      const open = [...prev.filter((t) => t.status === 'open')].sort((a, b) => a.sortOrder - b.sortOrder);
      const idx = open.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const j = direction === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= open.length) return prev;
      const a = open[idx]!;
      const b = open[j]!;
      const ao = a.sortOrder;
      const bo = b.sortOrder;
      const now = new Date().toISOString();
      return prev.map((t) => {
        if (t.id === a.id) return { ...t, sortOrder: bo, updatedAt: now };
        if (t.id === b.id) return { ...t, sortOrder: ao, updatedAt: now };
        return t;
      });
    });
  }, []);

  const bulkCompleteTodos = useCallback((ids: string[]) => {
    const idset = new Set(ids);
    const now = new Date().toISOString();
    setTodos((prev) =>
      prev.map((t) => {
        if (!idset.has(t.id) || t.status !== 'open') return t;
        const rec = t.recurrence;
        if (rec && rec !== 'none' && t.dueDate) {
          const nextDue = nextDueDateForRecurrence(t.dueDate, rec);
          return {
            ...t,
            dueDate: nextDue,
            subtasks: (t.subtasks ?? []).map((s) => ({ ...s, done: false })),
            lastReminderNotifiedYmd: undefined,
            updatedAt: now,
          };
        }
        return { ...t, status: 'completed' as TodoStatus, completedAt: now, updatedAt: now };
      }),
    );
  }, []);

  const bulkDeleteTodos = useCallback((ids: string[]): TodoItem[] => {
    const idset = new Set(ids);
    let removedSnapshot: TodoItem[] = [];
    setTodos((prev) => {
      removedSnapshot = prev.filter((t) => idset.has(t.id)).map((t) => ({ ...t }));
      return prev.filter((t) => !idset.has(t.id));
    });
    for (const t of removedSnapshot) void deleteAllAttachmentsForTodo(t.id);
    return removedSnapshot;
  }, []);

  const attachFileToTodo = useCallback(
    async (todoId: string, file: File): Promise<{ ok: boolean; error?: string }> => {
      if (!isIndexedDbAvailable()) {
        return { ok: false, error: 'File storage is not available in this browser.' };
      }
      if (file.size > MAX_TODO_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `Each file must be at most ${Math.floor(MAX_TODO_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
        };
      }
      const t = todosRef.current.find((x) => x.id === todoId);
      const current = t?.attachments ?? [];
      if (current.length >= MAX_ATTACHMENTS_PER_TODO) {
        return { ok: false, error: `At most ${MAX_ATTACHMENTS_PER_TODO} attachments per task.` };
      }
      const attId = newTodoId();
      const now = new Date().toISOString();
      const meta: TodoAttachmentMeta = {
        id: attId,
        name: file.name.trim().slice(0, 240) || 'attachment',
        mimeType: (file.type && file.type.trim()) || 'application/octet-stream',
        sizeBytes: file.size,
        createdAt: now,
      };
      try {
        await putTodoAttachmentBlob(todoId, attId, file);
      } catch {
        return { ok: false, error: 'Could not save the file.' };
      }
      updateTodo(todoId, { attachments: [...current, meta] });
      return { ok: true };
    },
    [updateTodo],
  );

  const removeAttachmentFromTodo = useCallback(
    async (todoId: string, attachmentId: string) => {
      await deleteTodoAttachmentBlob(todoId, attachmentId);
      const t = todosRef.current.find((x) => x.id === todoId);
      const next = (t?.attachments ?? []).filter((a) => a.id !== attachmentId);
      updateTodo(todoId, { attachments: next.length ? next : undefined });
    },
    [updateTodo],
  );

  const importTodosReplace = useCallback((items: TodoItem[]) => {
    const valid = items.filter(isTodoShape);
    setTodos(valid);
  }, []);

  const createFromNotification = useCallback((args: { id: string; message: string; pageLink: Page }): TodoItem | null => {
    if (todosRef.current.some((t) => t.sourceNotificationId === args.id)) return null;
    return addTodo({
      title: args.message.slice(0, 200),
      linkedPage: args.pageLink,
      sourceNotificationId: args.id,
      priority: 'medium',
    });
  }, [addTodo]);

  const { activeCount, overdueCount, dueTodayCount, snoozedCount } = useMemo(() => {
    const today = isoToday();
    const c = computeTaskCounts(todos, today);
    return {
      activeCount: c.active,
      overdueCount: c.overdue,
      dueTodayCount: c.dueToday,
      snoozedCount: c.snoozed,
    };
  }, [todos]);

  const value = useMemo<TodosContextValue>(
    () => ({
      todos,
      storageKey: key,
      activeCount,
      overdueCount,
      dueTodayCount,
      snoozedCount,
      addTodo,
      updateTodo,
      attachFileToTodo,
      removeAttachmentFromTodo,
      deleteTodo,
      restoreTodo,
      toggleComplete,
      clearCompleted,
      reorderTodo,
      bulkCompleteTodos,
      bulkDeleteTodos,
      importTodosReplace,
      createFromNotification,
    }),
    [
      todos,
      key,
      activeCount,
      overdueCount,
      dueTodayCount,
      snoozedCount,
      addTodo,
      updateTodo,
      attachFileToTodo,
      removeAttachmentFromTodo,
      deleteTodo,
      restoreTodo,
      toggleComplete,
      clearCompleted,
      reorderTodo,
      bulkCompleteTodos,
      bulkDeleteTodos,
      importTodosReplace,
      createFromNotification,
    ],
  );

  return <TodosContext.Provider value={value}>{children}</TodosContext.Provider>;
}

export function useTodos() {
  const ctx = useContext(TodosContext);
  if (!ctx) {
    throw new Error('useTodos must be used within TodosProvider');
  }
  return ctx;
}

export function useTodosOptional(): TodosContextValue | null {
  return useContext(TodosContext);
}
