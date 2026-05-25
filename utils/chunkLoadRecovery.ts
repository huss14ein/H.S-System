const CHUNK_RELOAD_KEY = 'finova_chunk_reload_once';

/** Recover from stale index.html → missing hashed chunk after deploy (dynamic import 404). */
export function installChunkLoadRecovery(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    } catch {
      // ignore
    }
    window.location.reload();
  });

  window.addEventListener('load', () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      // ignore
    }
  });
}
