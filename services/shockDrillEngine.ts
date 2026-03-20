import type { FinancialData } from '../types';
import { buildHouseholdBudgetPlan, buildHouseholdEngineInputFromData } from './householdBudgetEngine';
import { runWealthUltraEngine } from '../wealth-ultra';

export type ShockTemplateId = 'job_loss' | 'medical_spike' | 'rate_spike' | 'market_crash';

export interface ShockTemplate {
  id: ShockTemplateId;
  label: string;
  description: string;
  incomeShockPct: number;
  expenseShockPct: number;
  marketShockPct: number;
}

export const SHOCK_TEMPLATES: ShockTemplate[] = [
  { id: 'job_loss', label: 'Job loss', description: 'Income drops sharply for 3 months.', incomeShockPct: -60, expenseShockPct: 5, marketShockPct: -10 },
  { id: 'medical_spike', label: 'Medical expense', description: 'Expenses spike temporarily.', incomeShockPct: 0, expenseShockPct: 25, marketShockPct: -5 },
  { id: 'rate_spike', label: 'Rate spike', description: 'Higher cost of living / debt service.', incomeShockPct: 0, expenseShockPct: 10, marketShockPct: -8 },
  { id: 'market_crash', label: 'Market crash', description: 'Equities draw down sharply.', incomeShockPct: 0, expenseShockPct: 0, marketShockPct: -25 },
];

export interface ShockDrillResult {
  template: ShockTemplate;
  householdProjectedYearEndDelta: number;
  wealthUltraPortfolioValueDeltaPct: number;
  combinedRiskNote: string;
}

export function runShockDrill(data: FinancialData | null | undefined, templateId: ShockTemplateId): ShockDrillResult | null {
  if (!data) return null;
  const template = SHOCK_TEMPLATES.find(t => t.id === templateId);
  if (!template) return null;

  const year = new Date().getFullYear();
  const d = data as any;
  const tx = d?.personalTransactions ?? data.transactions ?? [];
  const accounts = d?.personalAccounts ?? data.accounts ?? [];
  const goals = data.goals ?? [];

  const input = buildHouseholdEngineInputFromData(
    tx as any[],
    accounts as any[],
    goals as any[],
    { year, expectedMonthlySalary: undefined, adults: 2, kids: 0, profile: 'Moderate', monthlyOverrides: [] }
  );
  const baseHousehold = buildHouseholdBudgetPlan(input);
  const shockedHousehold = buildHouseholdBudgetPlan({
    ...input,
    monthlySalaryPlan: input.monthlySalaryPlan.map(v => v * (1 + template.incomeShockPct / 100)),
    monthlyActualExpense: (input.monthlyActualExpense ?? []).map(v => v * (1 + template.expenseShockPct / 100)),
  });

  const baseOpening = baseHousehold.balanceProjection.openingLiquid ?? baseHousehold.balanceProjection.projectedYearEndLiquid ?? 0;
  const shockedOpening = shockedHousehold.balanceProjection.openingLiquid ?? shockedHousehold.balanceProjection.projectedYearEndLiquid ?? 0;
  const householdProjectedYearEndDelta =
    (shockedHousehold.balanceProjection.projectedYearEndLiquid - shockedOpening) -
    (baseHousehold.balanceProjection.projectedYearEndLiquid - baseOpening);

  const allHoldings = ((data as any)?.personalInvestments ?? data.investments ?? []).flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []);
  const priceMap: Record<string, number> = {};
  allHoldings.forEach((h: { symbol?: string; quantity?: number; currentValue?: number }) => {
    const sym = (h.symbol || '').toUpperCase();
    if (!sym) return;
    priceMap[sym] = (h.quantity ?? 0) > 0 ? (h.currentValue ?? 0) / (h.quantity ?? 1) : 0;
  });
  const baseWU = runWealthUltraEngine({ holdings: allHoldings, priceMap, config: undefined });
  const shockedPriceMap: Record<string, number> = {};
  Object.keys(priceMap).forEach(sym => {
    shockedPriceMap[sym] = priceMap[sym] * (1 + template.marketShockPct / 100);
  });
  const shockedWU = runWealthUltraEngine({ holdings: allHoldings, priceMap: shockedPriceMap, config: baseWU.config });
  const wealthUltraPortfolioValueDeltaPct =
    baseWU.totalPortfolioValue > 0
      ? ((shockedWU.totalPortfolioValue - baseWU.totalPortfolioValue) / baseWU.totalPortfolioValue) * 100
      : 0;

  const combinedRiskNote =
    householdProjectedYearEndDelta < 0 && wealthUltraPortfolioValueDeltaPct < -10
      ? 'Dual stress: household cashflow worsens while portfolio drawdown deepens. Prefer de-risking and buffer building.'
      : householdProjectedYearEndDelta < 0
      ? 'Household cashflow is stressed under this shock. Pause optional investment risk until buffers recover.'
      : wealthUltraPortfolioValueDeltaPct < -10
      ? 'Portfolio drawdown dominates this shock. Consider rebalancing into Core and reassessing concentration.'
      : 'Shock impact appears manageable under current assumptions.';

  return {
    template,
    householdProjectedYearEndDelta,
    wealthUltraPortfolioValueDeltaPct,
    combinedRiskNote,
  };
}

