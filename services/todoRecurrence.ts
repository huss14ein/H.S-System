import type { TodoRecurrence } from '../types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function nextDueDateForRecurrence(ymd: string, rule: TodoRecurrence | undefined): string {
  if (!ymd || !DAY.test(ymd) || !rule || rule === 'none') return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else if (rule === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidDueTime(hm: string | undefined): boolean {
  if (hm == null || hm === '') return false;
  return TIME.test(hm.trim());
}

/** ms for local due instant (interprets ymd + hm in local timezone). */
export function dueDateTimeMs(ymd: string, hm: string): number {
  const [hh, mm] = hm.trim().split(':').map((x) => parseInt(x, 10));
  return new Date(ymd + `T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();
}
