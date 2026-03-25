import React, { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Page, TodoItem, TodoPriority, TodoRecurrence, TodoSubtask } from '../types';
import { useTodos } from '../context/TodosContext';
import { ALL_TODO_LINK_PAGES, INVESTMENT_SUB_NAV_PAGE_NAMES, PAGE_DISPLAY_NAMES } from '../constants';
import { useToast } from '../context/ToastContext';
import { ClipboardDocumentListIcon } from './icons/ClipboardDocumentListIcon';
import { TrashIcon } from './icons/TrashIcon';
import { PencilIcon } from './icons/PencilIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { LinkIcon } from './icons/LinkIcon';
import { isTaskSnoozed, addCalendarDaysYmd, compareActionableTodos } from '../services/todoModel';
import { dueDateTimeMs, isValidDueTime } from '../services/todoRecurrence';
import { TODO_TEMPLATES } from '../services/todoTemplates';
import { newTodoId, parseTodosImportPayload } from '../services/todoStorage';
import { getTodoAttachmentBlob } from '../services/todoAttachmentIdb';
import {
  getDesktopTaskReminderOptIn,
  setDesktopTaskReminderOptIn,
  requestNotificationPermission,
  showTaskDueDesktopNotification,
} from '../services/taskDesktopNotifications';

const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 3, medium: 2, low: 1 };

const priorityLabel: Record<TodoPriority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

const priorityClass: Record<TodoPriority, string> = {
  high: 'bg-rose-100 text-rose-800 border-rose-200',
  medium: 'bg-amber-100 text-amber-900 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const REMINDER_DEFAULT_MIN = 15;

const RECURRENCE_LABELS: Record<TodoRecurrence, string> = {
  none: 'No repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const sortOpenTodos = compareActionableTodos;

type FilterTab = 'all' | 'open' | 'completed';
type SortMode = 'due' | 'priority' | 'created';

function parseTagsInput(raw: string): string[] {
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 24);
}

function navigateLinkedPage(
  page: Page,
  setActivePage: (page: Page) => void,
  triggerPageAction?: (page: Page, action: string) => void,
) {
  if (INVESTMENT_SUB_NAV_PAGE_NAMES.includes(page)) {
    if (triggerPageAction) triggerPageAction('Investments', `investment-tab:${page}`);
    else setActivePage('Investments');
  } else {
    setActivePage(page);
  }
}

const TodoListPanel: React.FC<{
  setActivePage: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}> = ({ setActivePage, triggerPageAction }) => {
  const {
    todos,
    activeCount,
    overdueCount,
    dueTodayCount,
    snoozedCount,
    addTodo,
    updateTodo,
    deleteTodo,
    restoreTodo,
    toggleComplete,
    clearCompleted,
    reorderTodo,
    bulkCompleteTodos,
    bulkDeleteTodos,
    importTodosReplace,
  } = useTodos();
  const { showToast } = useToast();

  const [quickTitle, setQuickTitle] = useState('');
  const [quickDue, setQuickDue] = useState('');
  const [quickDueTime, setQuickDueTime] = useState('');
  const [quickReminderMins, setQuickReminderMins] = useState<number>(REMINDER_DEFAULT_MIN);
  const [quickRecurrence, setQuickRecurrence] = useState<TodoRecurrence>('none');
  const [quickTags, setQuickTags] = useState('');
  const [quickList, setQuickList] = useState('');
  const [quickLink, setQuickLink] = useState<Page | ''>('');
  const [quickPinned, setQuickPinned] = useState(false);
  const [quickTemplateId, setQuickTemplateId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [quickPriority, setQuickPriority] = useState<TodoPriority>('medium');

  const [filter, setFilter] = useState<FilterTab>('open');
  const [sort, setSort] = useState<SortMode>('due');
  const [query, setQuery] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterList, setFilterList] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const importRef = useRef<HTMLInputElement>(null);
  const [desktopReminderOptIn, setDesktopReminderOptIn] = useState(() => getDesktopTaskReminderOptIn());

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of todos) for (const x of t.tags ?? []) s.add(x);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [todos]);

  const allLists = useMemo(() => {
    const s = new Set<string>();
    for (const t of todos) if (t.listId) s.add(t.listId);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [todos]);

  const openOrdered = useMemo(
    () => [...todos].filter((t) => t.status === 'open').sort((a, b) => sortOpenTodos(a, b)),
    [todos],
  );

  const reorderMeta = useCallback(
    (id: string) => {
      const idx = openOrdered.findIndex((t) => t.id === id);
      return {
        canUp: idx > 0,
        canDown: idx >= 0 && idx < openOrdered.length - 1,
      };
    },
    [openOrdered],
  );

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const today = todayIso();
      for (const t of todos) {
        if (t.status !== 'open' || !t.dueDate) continue;
        if (isTaskSnoozed(t, today)) continue;
        const hm = t.dueTime && isValidDueTime(t.dueTime) ? t.dueTime : '09:00';
        const dueMs = dueDateTimeMs(t.dueDate, hm);
        const before = (t.reminderMinutesBefore ?? REMINDER_DEFAULT_MIN) * 60 * 1000;
        const fireAt = dueMs - before;
        if (now < fireAt) continue;
        if (t.lastReminderNotifiedYmd === today) continue;
        const timeNote = t.dueTime && isValidDueTime(t.dueTime) ? '' : ' — 9:00 default';
        showToast(`Reminder${timeNote}: ${t.title}`, 'info', 12_000);
        if (getDesktopTaskReminderOptIn()) {
          showTaskDueDesktopNotification({
            title: `Task reminder${timeNote}`,
            body: t.title,
            tag: `finova-todo-remind-${t.id}-${today}`,
          });
        }
        updateTodo(t.id, { lastReminderNotifiedYmd: today });
      }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [todos, showToast, updateTodo]);

  const filtered = useMemo(() => {
    let list = [...todos];
    if (filter === 'open') list = list.filter((t) => t.status === 'open');
    else if (filter === 'completed') list = list.filter((t) => t.status === 'completed');
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          (t.tags && t.tags.some((x) => x.includes(q))) ||
          (t.listId && t.listId.toLowerCase().includes(q)),
      );
    }
    if (filterTag) list = list.filter((t) => t.tags?.includes(filterTag));
    if (filterList) list = list.filter((t) => t.listId === filterList);
    if (sort === 'priority') {
      list.sort((a, b) => {
        const p = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        if (p !== 0) return p;
        return sortOpenTodos(a, b);
      });
    } else if (sort === 'created') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      list.sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (a.status !== 'completed' && b.status === 'completed') return -1;
        return sortOpenTodos(a, b);
      });
    }
    return list;
  }, [todos, filter, sort, query, filterTag, filterList]);

  const grouped = useMemo(() => {
    const today = todayIso();
    const open = filtered.filter((t) => t.status === 'open');
    const done = filtered.filter((t) => t.status === 'completed');
    const snoozed: TodoItem[] = [];
    const overdue: TodoItem[] = [];
    const todayL: TodoItem[] = [];
    const upcoming: TodoItem[] = [];
    const nodate: TodoItem[] = [];
    for (const t of open) {
      if (isTaskSnoozed(t, today)) {
        snoozed.push(t);
        continue;
      }
      if (!t.dueDate) {
        nodate.push(t);
        continue;
      }
      if (t.dueDate < today) overdue.push(t);
      else if (t.dueDate === today) todayL.push(t);
      else upcoming.push(t);
    }
    snoozed.sort(sortOpenTodos);
    overdue.sort(sortOpenTodos);
    todayL.sort(sortOpenTodos);
    upcoming.sort(sortOpenTodos);
    nodate.sort(sortOpenTodos);
    done.sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
    return { snoozed, overdue, today: todayL, upcoming, nodate, done };
  }, [filtered]);

  const removeTaskWithUndo = useCallback(
    (id: string) => {
      const removed = deleteTodo(id);
      if (removed) {
        showToast('Task removed', 'default', 10_000, {
          label: 'Undo',
          onAction: () => restoreTodo(removed),
        });
      }
    },
    [deleteTodo, restoreTodo, showToast],
  );

  const applyTemplate = useCallback((tid: string) => {
    setQuickTemplateId(tid);
    if (!tid) return;
    const tpl = TODO_TEMPLATES.find((x) => x.id === tid);
    if (!tpl) return;
    setQuickTitle(tpl.title);
    setQuickPriority(tpl.priority);
    setQuickTags(tpl.tags?.join(', ') ?? '');
    setQuickList(tpl.listId ?? '');
    setQuickRecurrence(tpl.recurrence ?? 'none');
    setShowAdvanced(true);
  }, []);

  const handleQuickAdd = useCallback(() => {
    const title = quickTitle.trim();
    if (!title) {
      showToast('Enter a task title', 'error');
      return;
    }
    const dueT = quickDueTime.trim();
    addTodo({
      title,
      priority: quickPriority,
      dueDate: quickDue || undefined,
      dueTime: dueT && isValidDueTime(dueT) ? dueT : undefined,
      reminderMinutesBefore: quickReminderMins,
      recurrence: quickRecurrence === 'none' ? undefined : quickRecurrence,
      listId: quickList.trim() || undefined,
      tags: parseTagsInput(quickTags),
      linkedPage: quickLink || undefined,
      pinned: quickPinned,
    });
    setQuickTitle('');
    setQuickDue('');
    setQuickDueTime('');
    setQuickReminderMins(REMINDER_DEFAULT_MIN);
    setQuickRecurrence('none');
    setQuickTags('');
    setQuickList('');
    setQuickLink('');
    setQuickPinned(false);
    setQuickTemplateId('');
    setQuickPriority('medium');
    setShowAdvanced(false);
    showToast('Task added', 'success');
  }, [
    quickTitle,
    quickPriority,
    quickDue,
    quickDueTime,
    quickReminderMins,
    quickRecurrence,
    quickList,
    quickTags,
    quickLink,
    quickPinned,
    addTodo,
    showToast,
  ]);

  const exportTodosJson = useCallback(() => {
    const payload = {
      finovaTodosExport: 1,
      exportedAt: new Date().toISOString(),
      todos,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finova-todos-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Tasks exported', 'success');
  }, [todos, showToast]);

  const onImportFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result ?? '');
          const data = JSON.parse(text) as unknown;
          const parsed = parseTodosImportPayload(data);
          if (!parsed?.todos.length) {
            showToast('No valid tasks in file', 'error');
            return;
          }
          if (
            !window.confirm(`Replace all ${todos.length} tasks with ${parsed.todos.length} imported tasks? This cannot be undone.`)
          ) {
            return;
          }
          importTodosReplace(parsed.todos);
          setSelectedIds(new Set());
          setSelectMode(false);
          showToast(`Imported ${parsed.todos.length} tasks`, 'success');
        } catch {
          showToast('Could not read tasks file', 'error');
        }
      };
      reader.readAsText(file);
      if (importRef.current) importRef.current.value = '';
    },
    [importTodosReplace, showToast, todos.length],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisibleOpen = useCallback(() => {
    const ids = filtered.filter((t) => t.status === 'open').map((t) => t.id);
    setSelectedIds(new Set(ids));
  }, [filtered]);

  const bulkDeleteWithUndo = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const removed = bulkDeleteTodos(ids);
    setSelectedIds(new Set());
    setSelectMode(false);
    if (removed.length) {
      showToast(`${removed.length} tasks removed`, 'default', 12_000, {
        label: 'Undo',
        onAction: () => removed.forEach((t) => restoreTodo(t)),
      });
    }
  }, [selectedIds, bulkDeleteTodos, restoreTodo, showToast]);

  const bulkComplete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    bulkCompleteTodos(ids);
    setSelectedIds(new Set());
    showToast('Selected tasks updated', 'success');
  }, [selectedIds, bulkCompleteTodos, showToast]);

  const completedShown = filter !== 'open';

  const editingTodo = editingId ? todos.find((t) => t.id === editingId) : undefined;

  return (
    <section className="space-y-4" aria-labelledby="todo-list-panel-heading">
      <h2 id="todo-list-panel-heading" className="sr-only">
        My tasks
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatPill label="Open" value={activeCount} accent="text-primary" />
        <StatPill label="Overdue" value={overdueCount} accent={overdueCount > 0 ? 'text-rose-600' : 'text-slate-600'} />
        <StatPill label="Due today" value={dueTodayCount} accent={dueTodayCount > 0 ? 'text-amber-700' : 'text-slate-600'} />
        <StatPill label="Snoozed" value={snoozedCount} accent={snoozedCount > 0 ? 'text-slate-700' : 'text-slate-500'} />
        <StatPill
          label="Done (total)"
          value={todos.filter((t) => t.status === 'completed').length}
          accent="text-emerald-600"
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600"
        role="region"
        aria-label="Due reminder desktop notifications"
      >
        <label className="inline-flex items-center gap-2 cursor-pointer max-w-xl">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={desktopReminderOptIn}
            onChange={(e) => {
              const on = e.target.checked;
              setDesktopReminderOptIn(on);
              setDesktopTaskReminderOptIn(on);
            }}
          />
          <span>Also show system / browser notifications for due reminders (opt-in; tab can be in background on supported browsers)</span>
        </label>
        <button
          type="button"
          className="btn-ghost text-xs py-1 shrink-0"
          onClick={async () => {
            const p = await requestNotificationPermission();
            if (p === 'granted') showToast('Notification permission granted', 'success');
            else if (p === 'denied') showToast('Notifications are blocked in browser settings', 'error');
            else showToast('Notification permission dismissed', 'default');
          }}
        >
          Request notification permission
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="input-base flex-1 min-w-0"
              placeholder="Add a task…"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleQuickAdd();
                }
              }}
              aria-label="New task title"
            />
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn-primary shrink-0" onClick={handleQuickAdd}>
                Add task
              </button>
              <button
                type="button"
                className="btn-ghost text-sm shrink-0"
                onClick={() => setShowAdvanced((s) => !s)}
                aria-expanded={showAdvanced}
              >
                {showAdvanced ? 'Hide' : 'More'}
              </button>
            </div>
          </div>
          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1 border-t border-slate-100">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                Template (optional)
                <select
                  className="input-base h-9 text-sm"
                  value={quickTemplateId}
                  onChange={(e) => applyTemplate(e.target.value)}
                >
                  <option value="">— None —</option>
                  {TODO_TEMPLATES.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Due date
                <input
                  type="date"
                  className="input-base h-9 text-sm"
                  value={quickDue}
                  onChange={(e) => setQuickDue(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Due time (optional)
                <input
                  type="time"
                  className="input-base h-9 text-sm"
                  value={quickDueTime}
                  onChange={(e) => setQuickDueTime(e.target.value)}
                />
                <span className="text-[10px] font-normal text-slate-500">If empty, reminders use 9:00 on the due date.</span>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Remind me
                <select
                  className="input-base h-9 text-sm"
                  value={String(quickReminderMins)}
                  onChange={(e) => setQuickReminderMins(Number(e.target.value))}
                >
                  <option value="0">At due time</option>
                  <option value="15">15 minutes before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Repeats
                <select
                  className="input-base h-9 text-sm"
                  value={quickRecurrence}
                  onChange={(e) => setQuickRecurrence(e.target.value as TodoRecurrence)}
                >
                  {(Object.keys(RECURRENCE_LABELS) as TodoRecurrence[]).map((k) => (
                    <option key={k} value={k}>
                      {RECURRENCE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Priority
                <select
                  className="input-base h-9 text-sm"
                  value={quickPriority}
                  onChange={(e) => setQuickPriority(e.target.value as TodoPriority)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                List / project
                <input
                  className="input-base h-9 text-sm"
                  placeholder="e.g. Finance"
                  value={quickList}
                  onChange={(e) => setQuickList(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Tags
                <input
                  className="input-base h-9 text-sm"
                  placeholder="comma separated"
                  value={quickTags}
                  onChange={(e) => setQuickTags(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                Link to page
                <select
                  className="input-base h-9 text-sm"
                  value={quickLink}
                  onChange={(e) => setQuickLink((e.target.value || '') as Page | '')}
                >
                  <option value="">— None —</option>
                  {ALL_TODO_LINK_PAGES.map((p) => (
                    <option key={p} value={p}>
                      {PAGE_DISPLAY_NAMES[p] ?? p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 mt-auto pt-4 sm:pt-0">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={quickPinned}
                  onChange={(e) => setQuickPinned(e.target.checked)}
                />
                Pin to top
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input-base h-9 w-full sm:w-56 text-sm"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide" id="todo-filter-tag-label">
            Tag
          </span>
          <select
            className="input-base h-9 text-sm w-36"
            aria-labelledby="todo-filter-tag-label"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
          >
            <option value="">All</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide" id="todo-filter-list-label">
            List
          </span>
          <select
            className="input-base h-9 text-sm w-36"
            aria-labelledby="todo-filter-list-label"
            value={filterList}
            onChange={(e) => setFilterList(e.target.value)}
          >
            <option value="">All</option>
            {allLists.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide self-center" id="todo-filter-status-label">
          Show
        </span>
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-labelledby="todo-filter-status-label"
        >
          {(['all', 'open', 'completed'] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`todo-tab-${tab}`}
              aria-selected={filter === tab}
              aria-controls="todo-task-tabpanel"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
                filter === tab ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide ml-2 self-center">Sort</span>
        <select
          className="input-base h-9 text-sm w-44"
          aria-label="Sort tasks"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
        >
          <option value="due">Due date &amp; priority</option>
          <option value="priority">Priority</option>
          <option value="created">Recently created</option>
        </select>
        <button
          type="button"
          className={`btn-ghost text-sm ${selectMode ? 'text-primary font-semibold' : ''}`}
          onClick={() => {
            setSelectMode((m) => !m);
            setSelectedIds(new Set());
          }}
        >
          {selectMode ? 'Cancel select' : 'Select'}
        </button>
        {selectMode && (
          <>
            <button type="button" className="btn-ghost text-sm" onClick={selectAllVisibleOpen}>
              Select visible open
            </button>
            <button type="button" className="btn-primary text-sm" disabled={!selectedIds.size} onClick={bulkComplete}>
              Complete ({selectedIds.size})
            </button>
            <button type="button" className="btn-ghost text-sm text-rose-700" disabled={!selectedIds.size} onClick={bulkDeleteWithUndo}>
              Delete ({selectedIds.size})
            </button>
          </>
        )}
        <button type="button" className="btn-ghost text-sm" onClick={exportTodosJson}>
          Export tasks (JSON)
        </button>
        <button type="button" className="btn-ghost text-sm" onClick={() => importRef.current?.click()}>
          Import tasks…
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
        />
        {todos.some((t) => t.status === 'completed') && (
          <button
            type="button"
            className="btn-ghost text-sm text-rose-700 ml-auto"
            onClick={() => {
              if (window.confirm('Remove all completed tasks from the list?')) {
                clearCompleted();
                showToast('Completed tasks cleared', 'success');
              }
            }}
          >
            Clear completed
          </button>
        )}
      </div>

      <div id="todo-task-tabpanel" role="tabpanel" aria-labelledby={`todo-tab-${filter}`}>
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-10 text-center">
          <ClipboardDocumentListIcon className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-600 font-medium">No tasks match</p>
          <p className="text-sm text-slate-500 mt-1">
            Add a task above or change filters. Tip: <strong>Save as task</strong> from the Alerts tab, use <strong>Pin</strong> for
            priorities, and <strong>Snooze</strong> to hide items until a later date.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filter !== 'completed' && (
            <>
              <TodoSection
                title="Snoozed"
                mode="snoozed"
                items={grouped.snoozed}
                tone="slate"
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                onToggle={toggleComplete}
                onEdit={setEditingId}
                onDelete={removeTaskWithUndo}
                updateTodo={updateTodo}
                selectMode={selectMode}
                selectedIds={selectedIds}
                toggleSelected={toggleSelected}
                reorderTodo={reorderTodo}
                reorderMeta={reorderMeta}
              />
              <TodoSection
                title="Overdue"
                mode="active"
                items={grouped.overdue}
                tone="rose"
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                onToggle={toggleComplete}
                onEdit={setEditingId}
                onDelete={removeTaskWithUndo}
                updateTodo={updateTodo}
                selectMode={selectMode}
                selectedIds={selectedIds}
                toggleSelected={toggleSelected}
                reorderTodo={reorderTodo}
                reorderMeta={reorderMeta}
              />
              <TodoSection
                title="Due today"
                mode="active"
                items={grouped.today}
                tone="amber"
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                onToggle={toggleComplete}
                onEdit={setEditingId}
                onDelete={removeTaskWithUndo}
                updateTodo={updateTodo}
                selectMode={selectMode}
                selectedIds={selectedIds}
                toggleSelected={toggleSelected}
                reorderTodo={reorderTodo}
                reorderMeta={reorderMeta}
              />
              <TodoSection
                title="Upcoming"
                mode="active"
                items={grouped.upcoming}
                tone="slate"
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                onToggle={toggleComplete}
                onEdit={setEditingId}
                onDelete={removeTaskWithUndo}
                updateTodo={updateTodo}
                selectMode={selectMode}
                selectedIds={selectedIds}
                toggleSelected={toggleSelected}
                reorderTodo={reorderTodo}
                reorderMeta={reorderMeta}
              />
              <TodoSection
                title="No due date"
                mode="active"
                items={grouped.nodate}
                tone="slate"
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                onToggle={toggleComplete}
                onEdit={setEditingId}
                onDelete={removeTaskWithUndo}
                updateTodo={updateTodo}
                selectMode={selectMode}
                selectedIds={selectedIds}
                toggleSelected={toggleSelected}
                reorderTodo={reorderTodo}
                reorderMeta={reorderMeta}
              />
            </>
          )}
          {completedShown && grouped.done.length > 0 && (
            <TodoSection
              title="Completed"
              mode="completed"
              items={grouped.done}
              tone="emerald"
              setActivePage={setActivePage}
              triggerPageAction={triggerPageAction}
              onToggle={toggleComplete}
              onEdit={setEditingId}
              onDelete={removeTaskWithUndo}
              updateTodo={updateTodo}
              selectMode={selectMode}
              selectedIds={selectedIds}
              toggleSelected={toggleSelected}
              reorderTodo={reorderTodo}
              reorderMeta={reorderMeta}
            />
          )}
        </div>
      )}
      </div>

      {editingTodo && (
        <TodoEditModal
          key={editingTodo.id}
          todo={editingTodo}
          onClose={() => setEditingId(null)}
          onSave={(patch) => {
            updateTodo(editingTodo.id, patch);
            setEditingId(null);
            showToast('Task updated', 'success');
          }}
          onDelete={() => {
            const removed = deleteTodo(editingTodo.id);
            setEditingId(null);
            if (removed) {
              showToast('Task removed', 'default', 10_000, {
                label: 'Undo',
                onAction: () => restoreTodo(removed),
              });
            }
          }}
        />
      )}
    </section>
  );
};

function StatPill({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

type SectionMode = 'active' | 'snoozed' | 'completed';

const TodoSection: React.FC<{
  title: string;
  mode: SectionMode;
  items: TodoItem[];
  tone: 'rose' | 'amber' | 'slate' | 'emerald';
  setActivePage: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  updateTodo: (
    id: string,
    patch: Partial<
      Pick<
        TodoItem,
        | 'pinned'
        | 'snoozedUntil'
        | 'subtasks'
        | 'tags'
        | 'listId'
        | 'dueDate'
        | 'dueTime'
        | 'reminderMinutesBefore'
        | 'recurrence'
        | 'attachments'
      >
    >,
  ) => void;
  selectMode: boolean;
  selectedIds: Set<string>;
  toggleSelected: (id: string) => void;
  reorderTodo: (id: string, direction: 'up' | 'down') => void;
  reorderMeta: (id: string) => { canUp: boolean; canDown: boolean };
}> = ({
  title,
  mode,
  items,
  tone,
  setActivePage,
  triggerPageAction,
  onToggle,
  onEdit,
  onDelete,
  updateTodo,
  selectMode,
  selectedIds,
  toggleSelected,
  reorderTodo,
  reorderMeta,
}) => {
  if (items.length === 0) return null;
  const border =
    tone === 'rose'
      ? 'border-l-rose-400'
      : tone === 'amber'
        ? 'border-l-amber-400'
        : tone === 'emerald'
          ? 'border-l-emerald-400'
          : 'border-l-slate-300';
  const today = todayIso();
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2" id={`todo-section-${title.replace(/\s+/g, '-')}`}>
        {title} ({items.length})
      </h4>
      <ul className="space-y-2" aria-labelledby={`todo-section-${title.replace(/\s+/g, '-')}`}>
        {items.map((t) => {
          const { canUp, canDown } = reorderMeta(t.id);
          const subs = t.subtasks ?? [];
          const subDone = subs.filter((s) => s.done).length;
          return (
            <li
              key={t.id}
              className={`rounded-lg border border-slate-100 bg-white shadow-sm border-l-4 ${border} p-3 flex gap-3 items-start`}
            >
              {selectMode && (
                <input
                  type="checkbox"
                  className="mt-1.5 rounded border-slate-300"
                  checked={selectedIds.has(t.id)}
                  onChange={() => toggleSelected(t.id)}
                  aria-label={`Select task ${t.title}`}
                />
              )}
              <button
                type="button"
                onClick={() => onToggle(t.id)}
                className="mt-0.5 shrink-0"
                aria-label={t.status === 'completed' ? 'Mark as open' : 'Mark as completed'}
              >
                {t.status === 'completed' ? (
                  <CheckCircleIcon className="h-6 w-6 text-emerald-500" />
                ) : (
                  <span className="block h-6 w-6 rounded-full border-2 border-slate-300 hover:border-primary" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium flex items-center gap-2 flex-wrap ${
                    t.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-800'
                  }`}
                >
                  {t.pinned && mode !== 'completed' && (
                    <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded" title="Pinned">
                      Pinned
                    </span>
                  )}
                  {t.recurrence && t.recurrence !== 'none' && mode !== 'completed' && (
                    <span className="text-[10px] font-bold uppercase text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                      {RECURRENCE_LABELS[t.recurrence]}
                    </span>
                  )}
                  {t.title}
                  {(t.attachments?.length ?? 0) > 0 && (
                    <span
                      className="text-[10px] text-slate-500 tabular-nums"
                      aria-label={`${t.attachments!.length} attachment${t.attachments!.length === 1 ? '' : 's'}`}
                    >
                      📎 {t.attachments!.length}
                    </span>
                  )}
                </p>
                {t.notes && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{t.notes}</p>}
                {subs.length > 0 && mode !== 'completed' && (
                  <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {subs.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300"
                          checked={s.done}
                          onChange={() => {
                            const next = subs.map((x) => ( x.id === s.id ? { ...x, done: !x.done } : x));
                            updateTodo(t.id, { subtasks: next });
                          }}
                          aria-label={`Subtask ${s.title}`}
                        />
                        <span className={s.done ? 'line-through text-slate-400' : ''}>{s.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {subs.length > 0 && mode === 'completed' && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Checklist {subDone}/{subs.length}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${priorityClass[t.priority]}`}>
                    {priorityLabel[t.priority]}
                  </span>
                  {t.listId && (
                    <span className="text-[10px] text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                      {t.listId}
                    </span>
                  )}
                  {t.tags?.map((tag) => (
                    <span key={tag} className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                      #{tag}
                    </span>
                  ))}
                  {t.dueDate && (
                    <span className="text-[10px] text-slate-500">
                      Due {t.dueDate}
                      {t.dueTime && isValidDueTime(t.dueTime) && ` · ${t.dueTime}`}
                      {t.dueDate < today && t.status === 'open' && mode !== 'snoozed' && (
                        <span className="text-rose-600 font-semibold ml-1">(overdue)</span>
                      )}
                    </span>
                  )}
                  {mode === 'snoozed' && t.snoozedUntil && (
                    <span className="text-[10px] text-slate-500">Shows again on {t.snoozedUntil}</span>
                  )}
                  {t.linkedPage && (
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-primary inline-flex items-center gap-0.5 hover:underline"
                      onClick={() => navigateLinkedPage(t.linkedPage!, setActivePage, triggerPageAction)}
                    >
                      <LinkIcon className="h-3 w-3" />
                      {PAGE_DISPLAY_NAMES[t.linkedPage] ?? t.linkedPage}
                    </button>
                  )}
                </div>
                {mode === 'active' && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-slate-600 hover:text-primary"
                      onClick={() => updateTodo(t.id, { pinned: !t.pinned })}
                    >
                      {t.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-slate-600 hover:text-primary"
                      onClick={() => updateTodo(t.id, { snoozedUntil: addCalendarDaysYmd(today, 1) })}
                    >
                      Snooze 1d
                    </button>
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-slate-600 hover:text-primary"
                      onClick={() => updateTodo(t.id, { snoozedUntil: addCalendarDaysYmd(today, 3) })}
                    >
                      3d
                    </button>
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-slate-600 hover:text-primary"
                      onClick={() => updateTodo(t.id, { snoozedUntil: addCalendarDaysYmd(today, 7) })}
                    >
                      1wk
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      disabled={!canUp}
                      className="text-[10px] font-semibold text-slate-600 hover:text-primary disabled:opacity-40"
                      onClick={() => reorderTodo(t.id, 'up')}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      disabled={!canDown}
                      className="text-[10px] font-semibold text-slate-600 hover:text-primary disabled:opacity-40"
                      onClick={() => reorderTodo(t.id, 'down')}
                    >
                      Move down
                    </button>
                  </div>
                )}
                {mode === 'snoozed' && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-primary hover:underline"
                      onClick={() => updateTodo(t.id, { snoozedUntil: undefined })}
                    >
                      Resume now
                    </button>
                  </div>
                )}
              </div>
              {!selectMode && (
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                    onClick={() => onEdit(t.id)}
                    aria-label="Edit task"
                  >
                    <PencilIcon className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                    onClick={() => onDelete(t.id)}
                    aria-label="Delete task"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

type TodoPatch = Partial<
  Pick<
    TodoItem,
    | 'title'
    | 'notes'
    | 'priority'
    | 'dueDate'
    | 'dueTime'
    | 'reminderMinutesBefore'
    | 'recurrence'
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
>;

function useModalFocusTrap(panelRef: React.RefObject<HTMLDivElement | null>, onClose: () => void, openKey: string) {
  useLayoutEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const list = Array.from(focusables);
    list[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || list.length === 0) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        if (i <= 0) {
          e.preventDefault();
          list[list.length - 1]?.focus();
        }
      } else if (i === list.length - 1) {
        e.preventDefault();
        list[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelRef, onClose, openKey]);
}

const TodoEditModal: React.FC<{
  todo: TodoItem;
  onClose: () => void;
  onSave: (patch: TodoPatch) => void;
  onDelete: () => void;
}> = ({ todo, onClose, onSave, onDelete }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const { attachFileToTodo, removeAttachmentFromTodo } = useTodos();
  const { showToast } = useToast();
  useModalFocusTrap(panelRef, onClose, todo.id);

  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes ?? '');
  const [priority, setPriority] = useState<TodoPriority>(todo.priority);
  const [dueDate, setDueDate] = useState(todo.dueDate ?? '');
  const [dueTime, setDueTime] = useState(todo.dueTime ?? '');
  const [reminderMins, setReminderMins] = useState<number>(todo.reminderMinutesBefore ?? REMINDER_DEFAULT_MIN);
  const [recurrence, setRecurrence] = useState<TodoRecurrence>(todo.recurrence ?? 'none');
  const [linkedPage, setLinkedPage] = useState<Page | ''>(todo.linkedPage ?? '');
  const [listId, setListId] = useState(todo.listId ?? '');
  const [tagsStr, setTagsStr] = useState((todo.tags ?? []).join(', '));
  const [pinned, setPinned] = useState(!!todo.pinned);
  const [snoozedUntil, setSnoozedUntil] = useState(todo.snoozedUntil ?? '');
  const [subtasks, setSubtasks] = useState<TodoSubtask[]>(todo.subtasks?.length ? [...todo.subtasks] : []);

  const addSubtask = () => {
    setSubtasks((s) => [...s, { id: `st_${newTodoId()}`, title: '', done: false }]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-edit-title"
      >
        <h3 id="todo-edit-title" className="text-lg font-bold text-slate-900 mb-4">
          Edit task
        </h3>
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600">
            Title
            <input className="input-base mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Notes
            <textarea
              className="input-base mt-1 w-full min-h-[80px] text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional details…"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-600">
              Due date
              <input
                type="date"
                className="input-base mt-1 w-full h-9 text-sm"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Due time
              <input
                type="time"
                className="input-base mt-1 w-full h-9 text-sm"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-600">
              Remind me
              <select
                className="input-base mt-1 w-full h-9 text-sm"
                value={String(reminderMins)}
                onChange={(e) => setReminderMins(Number(e.target.value))}
              >
                <option value="0">At due time</option>
                <option value="15">15 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="1440">1 day before</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Repeats
              <select
                className="input-base mt-1 w-full h-9 text-sm"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as TodoRecurrence)}
              >
                {(Object.keys(RECURRENCE_LABELS) as TodoRecurrence[]).map((k) => (
                  <option key={k} value={k}>
                    {RECURRENCE_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-600">
              Priority
              <select
                className="input-base mt-1 w-full h-9 text-sm"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TodoPriority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              List / project
              <input
                className="input-base mt-1 w-full h-9 text-sm"
                value={listId}
                onChange={(e) => setListId(e.target.value)}
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-slate-600">
            Tags (comma separated)
            <input className="input-base mt-1 w-full h-9 text-sm" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Linked page
            <select
              className="input-base mt-1 w-full h-9 text-sm"
              value={linkedPage}
              onChange={(e) => setLinkedPage((e.target.value || '') as Page | '')}
            >
              <option value="">— None —</option>
              {ALL_TODO_LINK_PAGES.map((p) => (
                <option key={p} value={p}>
                  {PAGE_DISPLAY_NAMES[p] ?? p}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span id="todo-edit-attachments-heading" className="text-xs font-semibold text-slate-600">
                Attachments
              </span>
              <button
                type="button"
                className="text-xs font-semibold text-primary"
                onClick={() => attachmentInputRef.current?.click()}
              >
                Add file…
              </button>
            </div>
            <input
              ref={attachmentInputRef}
              type="file"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const result = await attachFileToTodo(todo.id, file);
                if (!result.ok) showToast(result.error ?? 'Could not attach file', 'error');
                else showToast('File attached', 'success');
              }}
            />
            <p className="text-[10px] text-slate-500 leading-snug">
              Files are stored in this browser only (IndexedDB). They are not included in JSON task export or sync.
            </p>
            <ul className="space-y-2" aria-labelledby="todo-edit-attachments-heading" role="list">
              {(todo.attachments ?? []).map((att) => (
                <li key={att.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                  <span className="truncate max-w-[200px]" title={att.name}>
                    {att.name}
                  </span>
                  <span className="text-slate-400 tabular-nums">({Math.max(1, Math.round(att.sizeBytes / 1024))} KB)</span>
                  <button
                    type="button"
                    className="text-primary font-semibold shrink-0"
                    onClick={async () => {
                      const blob = await getTodoAttachmentBlob(todo.id, att.id);
                      if (!blob) {
                        showToast('File not found', 'error');
                        return;
                      }
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = att.name;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    className="text-rose-600 shrink-0"
                    onClick={async () => {
                      await removeAttachmentFromTodo(todo.id, att.id);
                      showToast('Attachment removed', 'default');
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div role="group" aria-labelledby="todo-edit-checklist-label">
            <div className="flex items-center justify-between">
              <span id="todo-edit-checklist-label" className="text-xs font-semibold text-slate-600">
                Checklist
              </span>
              <button type="button" className="text-xs font-semibold text-primary" onClick={addSubtask}>
                Add item
              </button>
            </div>
            <ul className="mt-2 space-y-2">
              {subtasks.map((s, idx) => (
                <li key={s.id} className="flex gap-2 items-center">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 shrink-0"
                    checked={s.done}
                    onChange={() =>
                      setSubtasks((prev) => prev.map((x, i) => (i === idx ? { ...x, done: !x.done } : x)))
                    }
                    aria-label="Subtask done"
                  />
                  <input
                    className="input-base flex-1 h-9 text-sm"
                    value={s.title}
                    onChange={(e) =>
                      setSubtasks((prev) => prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))
                    }
                  />
                  <button
                    type="button"
                    className="text-xs text-rose-600 shrink-0"
                    onClick={() => setSubtasks((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" className="rounded border-slate-300" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to top of lists
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Snooze until (optional)
            <input
              type="date"
              className="input-base mt-1 w-full h-9 text-sm"
              value={snoozedUntil}
              onChange={(e) => setSnoozedUntil(e.target.value)}
            />
            <span className="text-[10px] font-normal text-slate-500 block mt-1">Task stays out of overdue/today lists until this date.</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2 justify-between mt-6 pt-4 border-t border-slate-100">
          <button
            type="button"
            className="btn-ghost text-rose-700 text-sm"
            onClick={() => {
              if (window.confirm('Delete this task?')) onDelete();
            }}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const t = title.trim();
                if (!t) return;
                const cleanSubs = subtasks
                  .map((s) => ({ ...s, title: s.title.trim() }))
                  .filter((s) => s.title.length > 0);
                onSave({
                  title: t,
                  notes: notes.trim() || undefined,
                  priority,
                  dueDate: dueDate || undefined,
                  dueTime: dueTime && isValidDueTime(dueTime) ? dueTime : undefined,
                  reminderMinutesBefore: reminderMins,
                  recurrence: recurrence === 'none' ? undefined : recurrence,
                  listId: listId.trim() || undefined,
                  tags: parseTagsInput(tagsStr),
                  linkedPage: linkedPage || undefined,
                  pinned,
                  snoozedUntil: snoozedUntil || undefined,
                  subtasks: cleanSubs.length ? cleanSubs : undefined,
                });
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TodoListPanel;
