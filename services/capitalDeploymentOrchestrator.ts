import type { FinancialData } from '../types';
import { cashRunwayMonths, normalizedMonthlyExpenseSar, freeCashFlow } from './financeMetrics';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
export type CapitalDeploymentAnswer = {
  investableSurplusSar: number;
  untouchableCashSar: number;
  emergencyFundMonths: number;
  emergencyFundComplete: boolean;
  monthlyFreeCashFlowSar: number;
  runwayMonths: number;
  canInvest: boolean;
  reasons: string[];
};

export function computeCapitalDeployment(
  data: FinancialData,
  uiExchangeRate: number,
  getAvailableCashForAccount: (id: string) => { SAR: number; USD: number },
  emergencyFundMonths: number,
  emergencyFundTargetMonths: number,
): CapitalDeploymentAnswer {
  const accounts = getPersonalAccounts(data);
  const txs = getPersonalTransactions(data);
  const liquidCash = accounts
    .filter((a) => a.type === 'Checking' || a.type === 'Savings')
    .reduce((s, a) => s + Math.max(0, getAvailableCashForAccount(a.id).SAR), 0);
  const monthlyExpense = normalizedMonthlyExpenseSar(txs, accounts, uiExchangeRate, { monthsLookback: 6, data });
  const runway = cashRunwayMonths(liquidCash, monthlyExpense);
  const efTarget = Math.max(1, emergencyFundTargetMonths) * monthlyExpense;
  const efComplete = emergencyFundMonths >= emergencyFundTargetMonths;
  const reserve = efComplete ? monthlyExpense * 2 : efTarget;
  const untouchable = Math.max(reserve, monthlyExpense);
  const investable = Math.max(0, liquidCash - untouchable);
  const fcf = freeCashFlow(txs, new Date());
  const reasons: string[] = [];
  if (!efComplete) reasons.push(`Emergency fund below target (${emergencyFundMonths.toFixed(1)} / ${emergencyFundTargetMonths} mo).`);
  if (runway < 2) reasons.push(`Cash runway is thin (${runway.toFixed(1)} mo).`);
  if (investable <= 0) reasons.push('Liquid cash is at or below operating reserve.');
  const canInvest = efComplete && runway >= 2 && investable > 500;
  return {
    investableSurplusSar: investable,
    untouchableCashSar: untouchable,
    emergencyFundMonths,
    emergencyFundComplete: efComplete,
    monthlyFreeCashFlowSar: fcf,
    runwayMonths: runway,
    canInvest,
    reasons,
  };
}
