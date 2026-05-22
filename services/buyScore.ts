import type { FinancialData, WatchlistItem } from '../types';
import { computeCapitalDeployment } from './capitalDeploymentOrchestrator';

export type BuyScoreResult = {
  score: number;
  allowed: boolean;
  reasons: string[];
};

export function computeBuyScore(
  data: FinancialData,
  _symbol: string,
  uiExchangeRate: number,
  getAvailableCashForAccount: (id: string) => { SAR: number; USD: number },
  emergencyFundMonths: number,
  emergencyFundTargetMonths: number,
  item?: WatchlistItem,
): BuyScoreResult {
  const cap = computeCapitalDeployment(
    data,
    uiExchangeRate,
    getAvailableCashForAccount,
    emergencyFundMonths,
    emergencyFundTargetMonths,
  );
  let score = 50;
  const reasons: string[] = [];
  if (item?.qualityScore != null) score += Math.min(20, Number(item.qualityScore) * 4);
  if (item?.valuationScore != null) score += Math.min(15, Number(item.valuationScore) * 3);
  if (cap.canInvest) {
    score += 15;
    reasons.push('Investable surplus available.');
  } else {
    score -= 25;
    reasons.push(...cap.reasons);
  }
  if (cap.runwayMonths >= 3) score += 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const allowed = score >= 55 && cap.canInvest;
  if (!allowed && !reasons.length) reasons.push('Buy score below threshold or capital gates not met.');
  return { score, allowed, reasons };
}
