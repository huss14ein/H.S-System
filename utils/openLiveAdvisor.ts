/** Cross-shell signal to open Live Advisor modal (hosted in Layout). */
export const OPEN_LIVE_ADVISOR_EVENT = 'finova:open-live-advisor';

export function openLiveAdvisor(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_LIVE_ADVISOR_EVENT));
}
