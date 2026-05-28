import type { FinancialData, InvestmentPlanSettings, InvestmentTransaction, TradeCurrency } from '../types';
import { aggregateMonthlyBudgetAcrossPortfolios } from '../utils/investmentPlanPerPortfolio';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { dateInRange, financialMonthRange, resolveMonthStartDayFromData } from '../utils/financialMonth';
import {
  inferInvestmentTransactionCurrency,
  resolveInvestmentTransactionAccountId,
} from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';

function convertPlanAmount(
  amount: number,
  from: TradeCurrency,
  to: TradeCurrency,
  sarPerUsd: number,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (from === to) return amount;
  if (from === 'USD' && to === 'SAR') return amount * sarPerUsd;
  if (from === 'SAR' && to === 'USD') return amount / sarPerUsd;
  return amount;
}

/** Header + Investments hub: buys in current financial month vs aggregated per-portfolio plan budget. */
export function computeMonthlyInvestmentPlanProgress(
  data: FinancialData | null | undefined,
  sarPerUsd: number,
  asOf: Date = new Date(),
): {
  percent: number;
  amount: number;
  target: number;
  finStart: string;
  finEnd: string;
  planCurrency: TradeCurrency;
  hasBudgetTarget: boolean;
} {
  const empty = {
    percent: 0,
    amount: 0,
    target: 0,
    finStart: '',
    finEnd: '',
    planCurrency: 'SAR' as TradeCurrency,
    hasBudgetTarget: false,
  };
  if (!data?.investmentPlan) return empty;

  const rate = Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : 3.75;
  const plan = data.investmentPlan;
  const planCurrency: TradeCurrency = (plan.budgetCurrency as TradeCurrency) || 'SAR';
  const monthStartDay = resolveMonthStartDayFromData(data);
  const { start: finStart, end: finEnd } = financialMonthRange(asOf, monthStartDay);
  const accounts = getPersonalAccounts(data);
  const investments = getPersonalInvestments(data);
  const personalAccountIds = new Set(accounts.map((a) => a.id));

  const monthlyInvested = (data.investmentTransactions ?? [])
    .filter((t) => {
      const aid = resolveInvestmentTransactionAccountId(
        t as InvestmentTransaction & { account_id?: string; portfolio_id?: string },
        accounts,
        investments,
      );
      if (!aid || !personalAccountIds.has(aid)) return false;
      return dateInRange(t.date, finStart, finEnd) && t.type === 'buy';
    })
    .reduce((sum, t) => {
      const txCurrency = inferInvestmentTransactionCurrency(t, accounts, investments);
      return sum + convertPlanAmount(getInvestmentTransactionCashAmount(t as InvestmentTransaction), txCurrency, planCurrency, rate);
    }, 0);

  const portfolioIds = investments.map((p) => p.id).filter(Boolean);
  const agg = aggregateMonthlyBudgetAcrossPortfolios(plan, portfolioIds, plan as InvestmentPlanSettings);
  const target = Number.isFinite(agg.total) ? agg.total : 0;
  const hasBudgetTarget = target > 0;

  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return {
    percent: hasBudgetTarget ? Math.min((monthlyInvested / target) * 100, 100) : 0,
    amount: monthlyInvested,
    target,
    finStart: fmt(finStart),
    finEnd: fmt(finEnd),
    planCurrency,
    hasBudgetTarget,
  };
}
