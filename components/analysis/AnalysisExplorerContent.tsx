import React, { useMemo } from 'react';
import type { Page } from '../../types';
import { useAnalyticsWorkspace } from '../../context/AnalyticsWorkspaceContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { ExpenseBudgetAnalysisModel } from '../../services/expenseBudgetAnalysisModel';
import {
  buildBudgetDrillDownAction,
  buildFiscalMonthDrillDownAction,
  buildMerchantDrillDownAction,
  triggerSpendingDrillDown,
} from '../../services/spendingDrillDown';
import { spendByMerchantSar, findRefundPairsSar } from '../../services/transactionIntelligence';
import { useCanonicalSpotFx } from '../../hooks/useCanonicalFinancialMetrics';
import type { FinancialData, Transaction, Account } from '../../types';
import { getPersonalAccounts, getPersonalTransactions } from '../../utils/wealthScope';
import SpendingMerchantTreemap from '../spending/SpendingMerchantTreemap';

type Props = {
  data: FinancialData | null | undefined;
  model: ExpenseBudgetAnalysisModel | null;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
};

export const AnalysisExplorerContent: React.FC<Props> = ({
  data,
  model,
  setActivePage,
  triggerPageAction,
}) => {
  const { analysisExplorerTab, setSelectedCategory, setSelectedMonthKey } = useAnalyticsWorkspace();
  const { formatCurrencyString } = useFormatCurrency();
  const fx = useCanonicalSpotFx();

  const accounts = useMemo(() => getPersonalAccounts(data) as Account[], [data]);
  const transactions = useMemo(() => getPersonalTransactions(data) as Transaction[], [data]);

  const merchants = useMemo(
    () => spendByMerchantSar(transactions, accounts, fx, { data }),
    [transactions, accounts, fx, data],
  );

  const refunds = useMemo(
    () => findRefundPairsSar(transactions, accounts, fx, 14),
    [transactions, accounts, fx],
  );

  const drillOpts = { setSelectedCategory };

  const drillCategory = (category: string) =>
    triggerSpendingDrillDown(
      triggerPageAction,
      setActivePage,
      buildBudgetDrillDownAction({ budgetCategory: category, data }),
      drillOpts,
    );

  const drillMerchant = (merchant: string) =>
    triggerSpendingDrillDown(triggerPageAction, setActivePage, buildMerchantDrillDownAction(merchant));

  const drillMonth = (monthKey: string) => {
    setSelectedMonthKey(monthKey);
    triggerSpendingDrillDown(triggerPageAction, setActivePage, buildFiscalMonthDrillDownAction(monthKey));
  };

  if (!model) {
    return <p className="text-sm text-slate-500 py-4">Loading explorer…</p>;
  }

  if (analysisExplorerTab === 'categories') {
    return (
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {model.categories.slice(0, 12).map((c) => (
          <li key={c.category} className="flex justify-between gap-3 px-4 py-3 text-sm">
            <button type="button" className="text-left text-primary hover:underline truncate" onClick={() => drillCategory(c.category)}>
              {c.category}
            </button>
            <span className="tabular-nums font-medium shrink-0">
              {formatCurrencyString(c.spentSar, { digits: 0 })}
              {c.limitSar > 0 ? ` · ${c.utilizationPct.toFixed(0)}%` : ''}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (analysisExplorerTab === 'merchants') {
    return (
      <div className="space-y-3">
        <SpendingMerchantTreemap merchants={merchants} onMerchantClick={drillMerchant} />
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {merchants.slice(0, 8).map((m) => (
            <li key={m.merchant} className="flex justify-between gap-3 px-4 py-2 text-sm">
              <button type="button" className="text-left text-primary hover:underline truncate" onClick={() => drillMerchant(m.merchant)}>
                {m.merchant}
              </button>
              <span className="tabular-nums font-medium">{formatCurrencyString(m.total, { digits: 0 })}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (analysisExplorerTab === 'cashflow') {
    return (
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {model.monthlyTrend.map((m) => (
          <li key={m.monthKey}>
            <button
              type="button"
              className="flex w-full justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50"
              onClick={() => drillMonth(m.monthKey)}
            >
              <span className="text-slate-700">{m.label}</span>
              <span className="tabular-nums">
                <span className="text-emerald-700">{formatCurrencyString(m.incomeSar, { digits: 0 })}</span>
                {' / '}
                <span className="text-rose-700">{formatCurrencyString(m.expenseSar, { digits: 0 })}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (analysisExplorerTab === 'refunds') {
    if (!refunds.length) {
      return <p className="text-sm text-slate-500 py-4">No refund pairs detected in the last 14 days.</p>;
    }
    return (
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {refunds.slice(0, 10).map((r, i) => (
          <li key={`${r.expenseId}-${i}`} className="px-4 py-3 text-sm text-slate-700">
            Refund pair · {formatCurrencyString(r.amount, { digits: 0 })} · {r.daysApart}d apart
          </li>
        ))}
      </ul>
    );
  }

  if (analysisExplorerTab === 'position') {
    return (
      <section
        className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700"
        aria-labelledby="analysis-explorer-position-heading"
      >
        <h3 id="analysis-explorer-position-heading" className="text-base font-semibold text-slate-900 mb-1">
          Balance sheet position
        </h3>
        <p>
          Net worth buckets (cash, investments, physical assets, debt) live in{' '}
          <strong>Current financial position</strong> below — same SAR math as Dashboard and Investments.
        </p>
        {setActivePage && (
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="text-primary text-sm font-medium hover:underline"
              onClick={() => setActivePage('Summary')}
            >
              Open Financial Summary →
            </button>
            <button
              type="button"
              className="text-primary text-sm font-medium hover:underline"
              onClick={() => setActivePage('Wealth Analytics')}
            >
              Open Wealth Analytics →
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <p className="text-sm text-slate-500 py-4">Select an explorer tab above.</p>
  );
};

export default AnalysisExplorerContent;
