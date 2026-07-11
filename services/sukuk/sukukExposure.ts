import type { FinancialData, SukukPosition } from '../../types';
import { toSAR } from '../../utils/currencyMath';
import { getPersonalSukukPositions } from '../../utils/wealthScope';

/** Active direct Sukuk positions only (excludes completed). */
export function getActivePersonalSukukPositions(data: FinancialData | null | undefined): SukukPosition[] {
  return getPersonalSukukPositions(data).filter((p) => p.status === 'active' && (p.outstandingPrincipal ?? 0) > 0);
}

function sukukPrincipalSar(
  position: SukukPosition,
  field: 'outstandingPrincipal' | 'purchasePrice',
  sarPerUsd: number,
): number {
  const raw = Math.max(0, Number(position[field]) || 0);
  if (!(raw > 0)) return 0;
  const currency = position.currency === 'USD' ? 'USD' : 'SAR';
  return toSAR(raw, currency, sarPerUsd);
}

/** Total SAR exposure from direct Sukuk contracts (active outstanding principal). */
export function sumPersonalSukukPositionsSar(
  data: FinancialData | null | undefined,
  sarPerUsd = 3.75,
): number {
  return getActivePersonalSukukPositions(data).reduce(
    (sum, p) => sum + sukukPrincipalSar(p, 'outstandingPrincipal', sarPerUsd),
    0,
  );
}

/** Cost basis for headline investment ROI (purchase price or outstanding). */
export function sumPersonalSukukPositionsCostSar(
  data: FinancialData | null | undefined,
  sarPerUsd = 3.75,
): number {
  return getActivePersonalSukukPositions(data).reduce((sum, p) => {
    const pp = Number(p.purchasePrice);
    const usePurchase = Number.isFinite(pp) && pp > 0;
    return sum + (usePurchase ? sukukPrincipalSar(p, 'purchasePrice', sarPerUsd) : sukukPrincipalSar(p, 'outstandingPrincipal', sarPerUsd));
  }, 0);
}

/** @deprecated Use sumPersonalSukukPositionsSar — legacy name during migration. */
export const sumPersonalSukukAssetsSar = sumPersonalSukukPositionsSar;
