/**
 * Available liquidity = liquid cash that is *free to deploy* after protecting the
 * emergency-fund floor and any virtual sinking-fund / goal escrow reserves.
 *
 * This is intentionally a small, pure layer so Dashboard, Plan, Accounts, and the
 * canonical metrics bundle share one definition:
 *
 *   availableLiquidity = max(0, liquidCash − emergencyFundFloor − goalReserves)
 *
 * Reserves are virtual escrow (see `Goal.reservedAmount`) — never a separate bank
 * account — and are subtracted so the user does not "double-spend" money already
 * earmarked toward a goal.
 */
import type { FinancialData } from '../types';

/** Sum of virtual escrow reserved toward goals (SAR-equivalent). Ignores negatives. */
export function sumGoalReservesSar(data: FinancialData | null | undefined): number {
  const goals = data?.goals ?? [];
  return goals.reduce((sum, g) => {
    const reserved = Number(g?.reservedAmount) || 0;
    return sum + (reserved > 0 ? reserved : 0);
  }, 0);
}

/**
 * Emergency-fund floor to keep untouched: `monthlyEssentialExpense × monthsTarget`,
 * never more than the liquid cash on hand (you can't reserve cash you don't have).
 */
export function computeEmergencyFundFloorSar(
  liquidCashSar: number,
  monthlyEssentialExpenseSar: number,
  monthsTarget: number,
): number {
  const liquid = Math.max(0, Number(liquidCashSar) || 0);
  const monthly = Math.max(0, Number(monthlyEssentialExpenseSar) || 0);
  const months = Math.max(0, Number(monthsTarget) || 0);
  const target = monthly * months;
  return Math.min(liquid, target);
}

export interface AvailableLiquidityInput {
  liquidCashSar: number;
  reservedSar: number;
  emergencyFundFloorSar: number;
}

/** Free-to-deploy liquidity after the emergency floor and goal escrow reserves. */
export function computeAvailableLiquiditySar(input: AvailableLiquidityInput): number {
  const liquid = Math.max(0, Number(input?.liquidCashSar) || 0);
  const reserved = Math.max(0, Number(input?.reservedSar) || 0);
  const floor = Math.max(0, Number(input?.emergencyFundFloorSar) || 0);
  return Math.max(0, liquid - floor - reserved);
}

export interface AvailableLiquiditySnapshot {
  liquidCashSar: number;
  reservedLiquiditySar: number;
  emergencyFundFloorSar: number;
  availableLiquiditySar: number;
}

/** Convenience roll-up used by the canonical metrics bundle. */
export function buildAvailableLiquiditySnapshot(args: {
  data: FinancialData | null | undefined;
  liquidCashSar: number;
  monthlyEssentialExpenseSar: number;
  monthsTarget: number;
}): AvailableLiquiditySnapshot {
  const reservedLiquiditySar = sumGoalReservesSar(args.data);
  const emergencyFundFloorSar = computeEmergencyFundFloorSar(
    args.liquidCashSar,
    args.monthlyEssentialExpenseSar,
    args.monthsTarget,
  );
  const availableLiquiditySar = computeAvailableLiquiditySar({
    liquidCashSar: args.liquidCashSar,
    reservedSar: reservedLiquiditySar,
    emergencyFundFloorSar,
  });
  return {
    liquidCashSar: Math.max(0, Number(args.liquidCashSar) || 0),
    reservedLiquiditySar,
    emergencyFundFloorSar,
    availableLiquiditySar,
  };
}
