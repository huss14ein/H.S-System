import type { SukukPosition, SukukPayoutEvent } from '../../types';

export type SukukPositionPrincipalUpdate = {
  outstandingPrincipal: number;
  status: SukukPosition['status'];
};

/** Apply principal repayment to a Sukuk position (in-memory; caller persists). */
export function applyPrincipalPaymentToSukukPosition(
  position: SukukPosition,
  principalAmount: number,
  payoutDate: string,
): SukukPositionPrincipalUpdate {
  const pay = Math.max(0, Number(principalAmount) || 0);
  const outstanding = Math.max(0, Number(position.outstandingPrincipal) || 0);
  const nextOutstanding = Math.max(0, outstanding - pay);
  const maturity = String(position.maturityDate ?? '').slice(0, 10);
  const onOrAfterMaturity = maturity.length === 10 && payoutDate >= maturity;
  const status: SukukPosition['status'] =
    nextOutstanding <= 0 || (onOrAfterMaturity && pay > 0 && nextOutstanding <= 0.01)
      ? 'completed'
      : position.status === 'completed'
        ? 'completed'
        : 'active';
  return {
    outstandingPrincipal: nextOutstanding,
    status: nextOutstanding <= 0 ? 'completed' : status,
  };
}

export function resolveMaturityPrincipalAmount(
  position: SukukPosition,
  configuredPrincipal: number | null | undefined,
): number {
  const configured = configuredPrincipal == null ? null : Math.max(0, Number(configuredPrincipal) || 0);
  if (configured != null && configured > 0) return configured;
  return Math.max(0, Number(position.outstandingPrincipal) || 0);
}

/** Build symbol for investment transaction from payout event. */
export function sukukPayoutInvestmentSymbol(positionId: string, kind: SukukPayoutEvent['kind']): string {
  return `SUKUK:${String(positionId).slice(0, 8)}:${kind.toUpperCase()}`;
}

/** One-shot principal event when a position matured with no pending principal payout. */
export function buildMaturityPrincipalEventDraft(
  position: SukukPosition,
  todayYmd: string,
): {
  sukukPositionId: string;
  investmentAccountId: string;
  kind: 'principal';
  payoutDate: string;
  amount: number;
  currency: SukukPosition['currency'];
} | null {
  if (position.status !== 'active') return null;
  const outstanding = Math.max(0, Number(position.outstandingPrincipal) || 0);
  if (!(outstanding > 0)) return null;
  const maturity = String(position.maturityDate ?? '').slice(0, 10);
  if (maturity.length !== 10 || maturity > todayYmd) return null;
  return {
    sukukPositionId: position.id,
    investmentAccountId: position.investmentAccountId,
    kind: 'principal',
    payoutDate: maturity,
    amount: outstanding,
    currency: position.currency === 'USD' ? 'USD' : 'SAR',
  };
}
