/** Shared visual language for feed alerts, preview rows, and inline notices. */

export type NotificationSeverity = 'info' | 'warning' | 'urgent';

export function notificationSeverityLabel(s: NotificationSeverity | undefined): string {
  if (s === 'urgent') return 'Urgent';
  if (s === 'warning') return 'Warning';
  return 'Info';
}

/** List row / preview card: left accent + soft tint (read items slightly muted). */
export function notificationRowSurface(severity: NotificationSeverity | undefined, isRead: boolean): string {
  const s = severity ?? 'info';
  const muted = isRead ? 'opacity-[0.93]' : '';
  const tone =
    s === 'urgent'
      ? 'border-l-4 border-l-rose-600 bg-rose-50/95 border-y border-r border-rose-100/90'
      : s === 'warning'
        ? 'border-l-4 border-l-amber-500 bg-amber-50/95 border-y border-r border-amber-100/90'
        : 'border-l-4 border-l-sky-600 bg-sky-50/90 border-y border-r border-sky-100/90';
  return `${tone} ${muted}`.trim();
}

/** Small pill for severity in compact UIs (header preview, chips). */
export function notificationSeverityPillClass(s: NotificationSeverity | undefined): string {
  const sev = s ?? 'info';
  if (sev === 'urgent') return 'bg-rose-100 text-rose-900 ring-1 ring-rose-200/80';
  if (sev === 'warning') return 'bg-amber-100 text-amber-950 ring-1 ring-amber-200/80';
  return 'bg-sky-100 text-sky-900 ring-1 ring-sky-200/80';
}
