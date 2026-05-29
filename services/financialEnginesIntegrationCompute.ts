import {
  buildUnifiedFinancialContext,
  runCrossEngineAnalysis,
  generatePrioritizedActionQueue,
  type UnifiedFinancialContext,
  type CrossEngineAnalysis,
  type CashConstraints,
  type RiskConstraints,
  type HouseholdConstraints,
} from './engineIntegration';
import { getPersonalTransactions, getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import type { FinancialData, Holding, InvestmentPortfolio, Page } from '../types';

function mapInvestmentsForContext(
  investments: InvestmentPortfolio[],
): Array<{
  id: string;
  symbol: string;
  quantity: number;
  shares: number;
  averageCost: number;
  avgCost: number;
  currentPrice: number;
  type: string;
}> {
  const out: Array<{
    id: string;
    symbol: string;
    quantity: number;
    shares: number;
    averageCost: number;
    avgCost: number;
    currentPrice: number;
    type: string;
  }> = [];
  (investments ?? []).forEach((port) => {
    (port.holdings ?? []).forEach((h: Holding) => {
      const q = Number(h.quantity ?? 0);
      const price = Number(h.currentValue ?? 0) / (q || 1) || Number(h.avgCost ?? 0);
      out.push({
        id: h.id ?? `${port.id}-${h.symbol}`,
        symbol: h.symbol ?? '',
        quantity: q,
        shares: q,
        averageCost: Number(h.avgCost ?? 0),
        avgCost: Number(h.avgCost ?? 0),
        currentPrice: price,
        type: 'stock',
      });
    });
  });
  return out;
}

export type FinancialEnginesIntegrationSnapshot = {
  context: UnifiedFinancialContext | null;
  analysis: CrossEngineAnalysis | null;
  actionQueue: Array<{
    action: string;
    priority: number;
    category: string;
    details: string;
    links?: Array<{ label: string; page: Page; action?: string }>;
  }>;
  cash: CashConstraints | null;
  risk: RiskConstraints | null;
  household: HouseholdConstraints | null;
  ready: boolean;
};

export const EMPTY_FINANCIAL_ENGINES_SNAPSHOT: FinancialEnginesIntegrationSnapshot = {
  context: null,
  analysis: null,
  actionQueue: [],
  cash: null,
  risk: null,
  household: null,
  ready: false,
};

export function computeFinancialEnginesIntegration(
  data: FinancialData | null | undefined,
  showHydrateBanner: boolean,
): FinancialEnginesIntegrationSnapshot {
  if (!data || showHydrateBanner) return EMPTY_FINANCIAL_ENGINES_SNAPSHOT;

  const transactions = getPersonalTransactions(data);
  const accounts = getPersonalAccounts(data);
  const budgets = data.budgets ?? [];
  const goals = data.goals ?? [];
  const investments = getPersonalInvestments(data);
  const investmentsFlat = mapInvestmentsForContext(investments);

  const context = buildUnifiedFinancialContext(transactions, accounts, budgets, goals, investmentsFlat);
  const analysis = runCrossEngineAnalysis(context);
  const actionQueue = generatePrioritizedActionQueue(analysis);

  return {
    context,
    analysis,
    actionQueue,
    cash: context.cash,
    risk: context.risk,
    household: context.household,
    ready: true,
  };
}
