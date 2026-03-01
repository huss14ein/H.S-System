/**
 * Centralized layout persistence for drag-and-drop grids.
 * Stores layout per page in localStorage so positions and sizes are remembered.
 */

const STORAGE_PREFIX = 'rgl-';

export interface StoredLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export type StoredLayout = readonly StoredLayoutItem[];

export function getStoredLayout(layoutKey: string): StoredLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + layoutKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLayoutItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredLayout(layoutKey: string, layout: StoredLayout): void {
  try {
    const toStore = Array.from(layout, ({ i, x, y, w, h, minW, minH }) => ({
      i,
      x,
      y,
      w,
      h,
      ...(minW != null && { minW }),
      ...(minH != null && { minH }),
    }));
    localStorage.setItem(STORAGE_PREFIX + layoutKey, JSON.stringify(toStore));
  } catch {
    // ignore
  }
}
