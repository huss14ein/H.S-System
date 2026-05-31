/** Drop stale PWA service workers that pin old bundles (common cause of mobile-only bugs). */
export async function clearStalePwaCaches(): Promise<void> {
  if (typeof window === 'undefined' || import.meta.env.DEV) return;
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
}
