import { describe, it, expect } from 'vitest';
import { isTodoShape, parseTodosImportPayload, todosStorageKey } from '../services/todoStorage';

const minimalTodo = {
  id: 'td_test',
  title: 'x',
  priority: 'medium' as const,
  status: 'open' as const,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
};

describe('todoStorage', () => {
  it('uses user-scoped keys', () => {
    expect(todosStorageKey('u1')).toContain('u1');
    expect(todosStorageKey(undefined)).toContain('local');
  });

  it('isTodoShape accepts valid tasks', () => {
    expect(isTodoShape(minimalTodo)).toBe(true);
    expect(isTodoShape({ ...minimalTodo, tags: ['a'], subtasks: [{ id: 's1', title: 'y', done: false }] })).toBe(true);
  });

  it('isTodoShape rejects invalid payloads', () => {
    expect(isTodoShape(null)).toBe(false);
    expect(isTodoShape({})).toBe(false);
    expect(isTodoShape({ ...minimalTodo, priority: 'nope' })).toBe(false);
  });

  it('parseTodosImportPayload reads wrapped export and raw arrays', () => {
    const wrapped = { finovaTodosExport: 1, todos: [minimalTodo] };
    expect(parseTodosImportPayload(wrapped)).toEqual({ todos: [minimalTodo] });
    expect(parseTodosImportPayload([minimalTodo])).toEqual({ todos: [minimalTodo] });
    expect(parseTodosImportPayload({ todos: [] })).toBe(null);
    expect(parseTodosImportPayload({})).toBe(null);
  });
});
