import type { FinancialData, SukukPosition } from '../../types';
import { getPersonalSukukPositions } from '../../utils/wealthScope';

/** Active direct Sukuk positions only (excludes completed). */
export function getActivePersonalSukukPositions(data: FinancialData | null | undefined): SukukPosition[] {
  return getPersonalSukukPositions(data).filter((p) => p.status === 'active' && (p.outstandingPrincipal ?? 0) > 0);
}

/** Total SAR exposure from direct Sukuk contracts (active outstanding principal). */
export function sumPersonalSukukPositionsSar(data: FinancialData | null | undefined): number {
  return getActivePersonalSukukPositions(data).reduce(
    (sum, p) => sum + Math.max(0, Number(p.outstandingPrincipal) || 0),
    0,
  );
}

/** Cost basis for headline investment ROI (purchase price or outstanding). */
export function sumPersonalSukukPositionsCostSar(data: FinancialData | null | undefined): number {
  return getActivePersonalSukukPositions(data).reduce((sum, p) => {
    const outstanding = Math.max(0, Number(p.outstandingPrincipal) || 0);
    const pp = Number(p.purchasePrice);
    const cost = Number.isFinite(pp) && pp > 0 ? pp : outstanding;
    return sum + cost;
  }, 0);
}

/** @deprecated Use sumPersonalSukukPositionsSar — legacy name during migration. */
export const sumPersonalSukukAssetsSar = sumPersonalSukukPositionsSar;
