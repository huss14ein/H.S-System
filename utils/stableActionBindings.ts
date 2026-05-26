import type { MutableRefObject } from 'react';

/**
 * Returns stable function references that always delegate to `actionsRef.current`.
 * Prevents context consumers from re-rendering when only the ref target changes.
 */
export function bindStableActions<T extends Record<string, (...args: never[]) => unknown>>(
  actionsRef: MutableRefObject<T>,
  keys: readonly (keyof T)[],
): T {
  const stable = {} as T;
  for (const key of keys) {
    stable[key] = ((...args: never[]) => actionsRef.current[key](...args)) as T[typeof key];
  }
  return stable;
}
