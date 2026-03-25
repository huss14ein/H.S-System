/**
 * Opt-in browser (OS) notifications for task due reminders.
 * Not true push server; works when the browser can show Notification (often requires tab open or brief background, OS-dependent).
 */

const PREF_KEY = 'finova_desktop_task_reminders_v1';

export function getDesktopTaskReminderOptIn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDesktopTaskReminderOptIn(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(PREF_KEY, '1');
    else window.localStorage.removeItem(PREF_KEY);
  } catch {
    /* ignore */
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/** Fire a single notification; no-op if API missing, denied, or opt-in off. */
export function showTaskDueDesktopNotification(opts: { title: string; body: string; tag: string }): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (!getDesktopTaskReminderOptIn()) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
    });
  } catch {
    /* ignore */
  }
}
