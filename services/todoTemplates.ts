import type { TodoPriority, TodoRecurrence } from '../types';

export type TodoTemplate = {
  id: string;
  title: string;
  priority: TodoPriority;
  tags?: string[];
  recurrence?: TodoRecurrence;
  listId?: string;
};

export const TODO_TEMPLATES: TodoTemplate[] = [
  { id: 'review-budget', title: 'Review monthly budget vs actuals', priority: 'high', tags: ['finance'], listId: 'Finance' },
  { id: 'zakat', title: 'Review Zakat eligibility and payments', priority: 'medium', tags: ['zakat'], listId: 'Finance' },
  { id: 'rebalance', title: 'Check portfolio drift vs plan', priority: 'medium', tags: ['investments'], listId: 'Investments' },
  { id: 'backup', title: 'Export Finova backup (Command Palette)', priority: 'low', tags: ['admin'] },
  { id: 'bills', title: 'Pay recurring bills', priority: 'high', tags: ['bills'], recurrence: 'monthly', listId: 'Home' },
];
