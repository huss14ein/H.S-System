import React, { useState, useMemo } from 'react';
import type { Account, Budget, FinancialData, Goal, Transaction } from '../../types';
import { DashboardSectionHeader } from './DashboardSectionHeader';
import {
  createDashboardDateRange,
  dashboardSuiteMonthsBack,
  DateRangePicker,
  type DashboardDateRange,
} from './DateRangePicker';
import { MomCashflowTrendChart } from './MomCashflowTrendChart';
import { BudgetBurnRatePanel } from './BudgetBurnRatePanel';
import { ExpenseDonutDrilldown } from './ExpenseDonutDrilldown';
import { WhatIfSandbox } from './WhatIfSandbox';
import { DeferredMount } from './DeferredMount';

/** Dashboard-only: monthly operations — cashflow, budgets, spending sandbox. */
export const DashboardOperationsCockpit: React.FC<{
  data: FinancialData | null | undefined;
  personalTransactions: Transaction[];
  personalAccounts: Account[];
  budgets: Budget[];
  goals: Goal[];
  sarPerUsd: number;
  liquidCashSar: number;
  investmentsTotalSar: number;
}> = ({
  data,
  personalTransactions,
  personalAccounts,
  budgets,
  goals,
  sarPerUsd,
  liquidCashSar,
  investmentsTotalSar,
}) => {
  const [suiteRange, setSuiteRange] = useState<DashboardDateRange>(() => createDashboardDateRange('6M'));
  const suiteMonthsBack = useMemo(() => dashboardSuiteMonthsBack(suiteRange), [suiteRange]);

  return (
    <div className="mb-6 space-y-4">
      <DashboardSectionHeader titleKey="dashboardCockpitTitle" subtitleKey="dashboardCockpitSubtitle" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-1">
          <DateRangePicker value={suiteRange} onChange={setSuiteRange} />
        </div>
        <div className="lg:col-span-2">
          <MomCashflowTrendChart
            data={data}
            uiExchangeRate={sarPerUsd}
            startIso={suiteRange.startIso}
            endIso={suiteRange.endIso}
            monthsBack={suiteMonthsBack}
          />
        </div>
      </div>
      <DeferredMount minHeight="14rem">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <BudgetBurnRatePanel
            data={data}
            budgets={budgets}
            transactions={personalTransactions}
            accounts={personalAccounts}
            uiExchangeRate={sarPerUsd}
          />
          <ExpenseDonutDrilldown
            data={data}
            transactions={personalTransactions}
            accounts={personalAccounts}
            uiExchangeRate={sarPerUsd}
          />
        </div>
        <div className="mt-3">
          <WhatIfSandbox
            data={data}
            goals={goals}
            sarPerUsd={sarPerUsd}
            liquidCashSar={liquidCashSar}
            investmentsTotalSar={investmentsTotalSar}
          />
        </div>
      </DeferredMount>
    </div>
  );
};
