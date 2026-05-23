/**
 * Per-symbol choice: position recycling (no new cash) OR recovery buy ladder (deployable cash).
 * Stored in localStorage so the user picks one path at a time — not hybrid.
 */

export type RecoveryPathMode = 'recycling' | 'recovery_ladder';

const STORAGE_KEY = 'recovery-path-mode:v1';
const mem = new Map<string, RecoveryPathMode>();

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function';
  } catch {
    return false;
  }
}

export function loadRecoveryPathMode(symbol: string): RecoveryPathMode | null {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;
  if (hasLocalStorage()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const map = JSON.parse(raw) as Record<string, RecoveryPathMode>;
        if (map[sym] === 'recycling' || map[sym] === 'recovery_ladder') return map[sym];
      }
    } catch {
      /* ignore */
    }
  }
  return mem.get(sym) ?? null;
}

export function saveRecoveryPathMode(symbol: string, mode: RecoveryPathMode): void {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;
  mem.set(sym, mode);
  if (!hasLocalStorage()) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const map: Record<string, RecoveryPathMode> = raw ? JSON.parse(raw) : {};
    map[sym] = mode;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}
