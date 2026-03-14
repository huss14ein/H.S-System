/**
 * Intelligent control tower: simulations, scenarios, and integration with Household and Wealth Ultra.
 * Shows household stress, shared cash constraints, and scenario impact.
 */

import React, { useMemo, useState } from 'react';
import { buildHouseholdBudgetPlan, sumLiquidCash, mapGoalsForRouting, DEFAULT_HOUSEHOLD_ENGINE_CONFIG } from '../services/householdBudgetEngine';
import { computeSharedConstraints } from '../services/engineConstraints';
import { runWealthUltraEngine } from '../wealth-ultra';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { Holding } from '../types';

type ScenarioId = 'base' | 'recession' | 'job_loss' | 'promotion';

const SCENARIOS: { id: ScenarioId; label: string; cashMultiplier: number; description: string }[] = [
  { id: 'base', label: 'Base', cashMultiplier: 1, description: 'Current household and budget.' },
  { id: 'recession', label: 'Recession', cashMultiplier: 0.6, description: 'Income −10%, expenses +5%; reduce deployable 40%.' },
  { id: 'job_loss', label: 'Job loss', cashMultiplier: 0.2, description: 'Minimal deployable; preserve reserve.' },
  { id: 'promotion', label: 'Promotion', cashMultiplier: 1.2, description: 'Income +15%; allow 20% more deployable.' },
];

interface InvestmentPlanControlTowerProps {
  accounts: Array<{ type?: string; balance?: number }>;
  transactions: Array<{ date: string; type: string; amount: number }>;
  goals: Array<{ id: string; name: string; targetAmount: number; currentAmount: number; deadline: string; savingsAllocationPercent?: number }>;
  /** All holdings for Wealth Ultra summary (optional). */
  holdings?: Holding[];
  priceMap?: Record<string, number>;
  onOpenWealthUltra?: () => void;
}

export const InvestmentPlanControlTower: React.FC<InvestmentPlanControlTowerProps> = ({
  accounts,
  transactions,
  goals,
  holdings = [],
  priceMap = {},
  onOpenWealthUltra,
}) => {
  const { formatCurrencyString } = useFormatCurrency();
  const [scenario, setScenario] = useState<ScenarioId>('base');

  const household = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const incomeByMonth = Array(12).fill(0);
    const expenseByMonth = Array(12).fill(0);
    transactions.forEach((t) => {
      const d = new Date(t.date);
      if (d.getFullYear() !== year) return;
      const m = d.getMonth();
      const amount = Number(t.amount) || 0;
      if (t.type === 'income') incomeByMonth[m] += Math.max(0, amount);
      if (t.type === 'expense') expenseByMonth[m] += Math.abs(amount);
    });
    const liquidCash = sumLiquidCash(accounts);
    const goalsForRouting = mapGoalsForRouting(goals);
    return buildHouseholdBudgetPlan({
      monthlySalaryPlan: incomeByMonth,
      monthlyActualIncome: incomeByMonth,
      monthlyActualExpense: expenseByMonth,
      householdDefaults: { adults: 2, kids: 0 },
      monthlyOverrides: [],
      liquidBalance: liquidCash,
      emergencyBalance: liquidCash,
      reserveBalance: liquidCash * 0.4,
      goals: goalsForRouting,
      config: DEFAULT_HOUSEHOLD_ENGINE_CONFIG,
    });
  }, [accounts, transactions, goals]);

  const rawDeployableCash = useMemo(() => {
    return sumLiquidCash(accounts) * 0.5;
  }, [accounts]);

  const constraints = useMemo(() => {
    return computeSharedConstraints({
      householdStress: household.stressSignals,
      budgetMaxInvestable: undefined,
      rawDeployableCash,
      riskTolerance: 'moderate',
    });
  }, [household.stressSignals, rawDeployableCash]);

  const scenarioCappedCash = useMemo(() => {
    const mult = SCENARIOS.find((s) => s.id === scenario)?.cashMultiplier ?? 1;
    return Math.max(0, constraints.cappedDeployableCash * mult);
  }, [constraints.cappedDeployableCash, scenario]);

  const wealthUltraSummary = useMemo(() => {
    if (!holdings || holdings.length === 0) return null;
    try {
      const state = runWealthUltraEngine({
        holdings,
        priceMap,
        config: { cashAvailable: scenarioCappedCash },
        scenarioCashCap: scenarioCappedCash,
      });
      return {
        deployableCash: state.deployableCash,
        portfolioHealth: state.portfolioHealth,
        cashPlannerStatus: state.cashPlannerStatus,
      };
    } catch {
      return null;
    }
  }, [holdings, priceMap, scenarioCappedCash]);

  const stressLabel = household.stressSignals.overall;
  const stressColor =
    stressLabel === 'healthy' ? 'text-emerald-700 bg-emerald-50' :
    stressLabel === 'caution' ? 'text-amber-700 bg-amber-50' :
    stressLabel === 'stress' ? 'text-orange-700 bg-orange-50' : 'text-rose-700 bg-rose-50';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="Control tower">
      <h2 className="text-lg font-bold text-slate-900 mb-3">Control Tower</h2>
      <p className="text-sm text-slate-600 mb-4">
        Household, budget, and Wealth Ultra constraints in one place. Use scenarios to see impact on deployable cash.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="rounded-lg border border-slate-100 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Household stress</p>
          <p className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-sm font-medium ${stressColor}`}>
            {stressLabel}
          </p>
          <p className="text-xs text-slate-500 mt-1">Runway: {household.stressSignals.runwayMonths.toFixed(1)} mo</p>
        </div>
        <div className="rounded-lg border border-slate-100 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Capped deployable</p>
          <p className="mt-1 font-semibold text-slate-900 tabular-nums">{formatCurrencyString(constraints.cappedDeployableCash, { digits: 0 })}</p>
          {constraints.capReason !== 'none' && (
            <p className="text-xs text-amber-600 mt-0.5">{constraints.warning}</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-100 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Scenario</p>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as ScenarioId)}
            className="mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-primary focus:border-primary"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1">{formatCurrencyString(scenarioCappedCash, { digits: 0 })} after scenario</p>
        </div>
        <div className="rounded-lg border border-slate-100 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Wealth Ultra</p>
          {wealthUltraSummary ? (
            <>
              <p className="mt-1 font-semibold text-slate-900 tabular-nums">{formatCurrencyString(wealthUltraSummary.deployableCash, { digits: 0 })}</p>
              <p className={`text-xs mt-0.5 ${wealthUltraSummary.cashPlannerStatus === 'OVER_BUDGET' ? 'text-rose-600' : 'text-slate-500'}`}>
                {wealthUltraSummary.portfolioHealth.label}
              </p>
              {onOpenWealthUltra && (
                <button type="button" onClick={onOpenWealthUltra} className="mt-2 text-xs font-medium text-primary hover:underline">
                  Open Wealth Ultra →
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500 mt-1">Add holdings to see summary.</p>
          )}
        </div>
      </div>
      <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
        {SCENARIOS.find((s) => s.id === scenario)?.description}
      </div>
    </section>
  );
};

export default InvestmentPlanControlTower;
