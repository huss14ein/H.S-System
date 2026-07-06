import React from 'react';
import type { FinancialData, Page } from '../../../types';
import type { SimulatedPriceMap } from '../../../services/investmentPlatformCardMetrics';
import { DeferredMount } from '../../dashboard/DeferredMount';
import { DashboardSectionHeader } from '../../dashboard/DashboardSectionHeader';
import {
  PortfolioPeriodPnLPanelSection,
  PortfolioHoldingsGridSection,
  CostAveragingCalculatorSection,
  Goals2030TimelineSection,
} from '../wealthAnalyticsLazySections';

const BELOW_FOLD_ROOT_MARGIN = '320px';

type Props = {
  data: FinancialData;
  personalInvestments: FinancialData['investments'];
  personalAccounts: FinancialData['accounts'];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  monthStartDay: number;
  getAvailableCashForAccount: (id: string) => { SAR: number; USD: number };
  setActivePage?: (page: Page) => void;
  goals: FinancialData['goals'];
  holdingsPortfolioId: string;
  onHoldingsPortfolioChange: (id: string) => void;
  portfoliosWithHoldings: { id: string; name?: string }[];
  t: (key: string) => string;
};

export const InvestmentsZone: React.FC<Props> = (props) => (
  <div className="space-y-6">
    <section className="min-w-0 w-full" aria-label="Portfolio period performance">
      <PortfolioPeriodPnLPanelSection
        data={props.data}
        portfolios={props.personalInvestments}
        accounts={props.personalAccounts}
        sarPerUsd={props.sarPerUsd}
        simulatedPrices={props.simulatedPrices}
        monthStartDay={props.monthStartDay}
        getAvailableCashForAccount={props.getAvailableCashForAccount}
        setActivePage={props.setActivePage}
      />
    </section>
    <section className="min-w-0 w-full" aria-label="Holdings and tools">
      <DashboardSectionHeader
        titleKey="analyticsHoldingsTitle"
        subtitleKey="analyticsHoldingsSubtitle"
        showLanguageToggle={false}
      />
      {props.portfoliosWithHoldings.length > 0 && (
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <label htmlFor="wealth-analytics-portfolio" className="text-sm font-medium text-slate-700 shrink-0">
            {props.t('portfolioLabel')}
          </label>
          <select
            id="wealth-analytics-portfolio"
            value={props.holdingsPortfolioId}
            onChange={(e) => props.onHoldingsPortfolioChange(e.target.value)}
            className="input-base w-full sm:max-w-md"
          >
            {props.portfoliosWithHoldings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <DeferredMount minHeight="12rem" staggerIndex={1} rootMargin={BELOW_FOLD_ROOT_MARGIN} loadingLabelKey="sectionLoading">
        <div className="space-y-4">
          <PortfolioHoldingsGridSection
            portfolios={props.personalInvestments}
            simulatedPrices={props.simulatedPrices}
            sarPerUsd={props.sarPerUsd}
            portfolioId={props.holdingsPortfolioId || null}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            <CostAveragingCalculatorSection
              portfolios={props.personalInvestments}
              portfolioId={props.holdingsPortfolioId || null}
            />
            <Goals2030TimelineSection
              data={props.data}
              goals={props.goals}
              sarPerUsd={props.sarPerUsd}
              onOpenGoals={props.setActivePage ? () => props.setActivePage!('Goals') : undefined}
            />
          </div>
        </div>
      </DeferredMount>
    </section>
  </div>
);

export default InvestmentsZone;
