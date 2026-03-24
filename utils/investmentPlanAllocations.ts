/**
 * Investment plan sleeve fractions from DB/API (single source for DataContext + tests).
 * DB may store 0.7 or 70 (percent-style); UI always uses 0–1.
 */

export function normalizeSleeveFraction(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1.001 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

export function normalizeCoreUpsideAllocations(
  coreRaw: unknown,
  upsideRaw: unknown,
  defaults: { core: number; upside: number },
): { core: number; upside: number } {
  let core = normalizeSleeveFraction(coreRaw, defaults.core);
  let upside = normalizeSleeveFraction(upsideRaw, defaults.upside);
  const sum = core + upside;
  if (sum < 0.01) return { core: defaults.core, upside: defaults.upside };
  if (Math.abs(sum - 1) <= 0.02) return { core, upside };
  return {
    core: Number((core / sum).toFixed(4)),
    upside: Number((upside / sum).toFixed(4)),
  };
}
