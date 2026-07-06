import React from 'react';
import type { FinancialData, Page } from '../../../types';
import { DeferredMount } from '../../dashboard/DeferredMount';
import SpendingCommandCenter from '../../spending/SpendingCommandCenter';
import { DashboardOperationsCockpitSection } from '../wealthAnalyticsLazySections';
import type { ExpenseBudgetAnalysisModel } from '../../../services/expenseBudgetAnalysisModel';
import { downloadSpendingBriefCsv, downloadSpendingBriefPdf } from '../../../services/spendingReportExport';

const BELOW_FOLD_ROOT_MARGIN = '320px';

type Props = {
  data: FinancialData;
  personalTransactions: FinancialData['transactions'];
  personalAccounts: FinancialData['accounts'];
  budgets: FinancialData['budgets'];
  goals: FinancialData['goals'];
  sarPerUsd: number;
  liquidCashSar: number;
  investmentsTotalSar: number;
  spendingModel: ExpenseBudgetAnalysisModel | null;
  spendingReady: boolean;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
};

export const CashSpendZone: React.FC<Props> = (props) => (
  <section className="min-w-0 w-full space-y-4" aria-label="Operations cockpit">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <SpendingCommandCenter
        model={props.spendingModel}
        ready={props.spendingReady}
        setActivePage={props.setActivePage}
        triggerPageAction={props.triggerPageAction}
      />
      {props.spendingReady && props.spendingModel && (
        <div className="flex gap-2 shrink-0">
          <button type="button" className="btn-secondary text-sm" onClick={() => downloadSpendingBriefCsv(props.spendingModel!)}>
            Export CSV
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={() => downloadSpendingBriefPdf(props.spendingModel!)}>
            Print PDF brief
          </button>
        </div>
      )}
    </div>
    <DeferredMount minHeight="16rem" staggerIndex={0} rootMargin={BELOW_FOLD_ROOT_MARGIN} loadingLabelKey="sectionLoading">
      <DashboardOperationsCockpitSection
        data={props.data}
        personalTransactions={props.personalTransactions}
        personalAccounts={props.personalAccounts}
        budgets={props.budgets}
        goals={props.goals}
        sarPerUsd={props.sarPerUsd}
        liquidCashSar={props.liquidCashSar}
        investmentsTotalSar={props.investmentsTotalSar}
        showLanguageToggle={false}
        setActivePage={props.setActivePage}
        triggerPageAction={props.triggerPageAction}
      />
    </DeferredMount>
  </section>
);

export default CashSpendZone;
