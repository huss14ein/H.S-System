/**
 * Planning assumptions engine (logic layer).
 * Centralizes assumptions so they can be edited and validated.
 */

export interface AssumptionRange {
  min: number;
  max: number;
  step?: number;
}

export interface AssumptionSpec {
  value: number;
  range?: AssumptionRange;
  label?: string;
  unit?: string;
}

export type AssumptionsMap = Record<string, AssumptionSpec>;

export function getPlanningAssumption(args: {
  assumptions: AssumptionsMap;
  key: string;
  fallback?: number;
}): number {
  const spec = args.assumptions?.[args.key];
  if (!spec) return args.fallback ?? 0;
  const v = Number(spec.value);
  return Number.isFinite(v) ? v : args.fallback ?? 0;
}

export function validateAssumptionRanges(args: {
  assumptions: AssumptionsMap;
}): { ok: boolean; errors: { key: string; message: string }[] } {
  const errors: { key: string; message: string }[] = [];
  const assumptions = args.assumptions ?? {};
  for (const [key, spec] of Object.entries(assumptions)) {
    if (!spec.range) continue;
    const v = Number(spec.value);
    if (!Number.isFinite(v)) {
      errors.push({ key, message: 'Value is not a number.' });
      continue;
    }
    if (v < spec.range.min || v > spec.range.max) {
      errors.push({ key, message: `Value ${v} out of range [${spec.range.min}, ${spec.range.max}].` });
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assumptionImpactSummary(args: {
  baseline: number;
  impacted: number;
  label?: string;
}): { label: string; delta: number; deltaPct: number } {
  const baseline = Number.isFinite(args.baseline) ? args.baseline : 0;
  const impacted = Number.isFinite(args.impacted) ? args.impacted : baseline;
  const delta = impacted - baseline;
  const deltaPct = baseline !== 0 ? (delta / baseline) * 100 : impacted !== 0 ? 100 : 0;
  return { label: args.label ?? 'Assumption impact', delta, deltaPct };
}

