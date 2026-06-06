import React from 'react';
import CollapsibleSection from '../CollapsibleSection';
import EnhancementInsightStrip from '../EnhancementInsightStrip';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { usePrivacyMask } from '../../context/PrivacyContext';
import { useFinancialEnhancementInsights } from '../../hooks/useFinancialEnhancementInsights';
import { useWealthAnalyticsDeferredInsights } from '../../hooks/useWealthAnalyticsDeferredInsights';
import type { computeWealthSummaryReportModel } from '../../services/wealthSummaryReportModel';
import type { FinancialData, Goal, Page, Transaction } from '../../types';
import type { DashboardKpiSnapshot } from '../../services/dashboardKpiSnapshot';
import {
  WealthAnalyticsSummaryPanelsSection,
  AIExecutiveSummarySection,
  AIFeedSection,
  MultiStockAnalysisSection,
} from './wealthAnalyticsLazySections';

type ReportModel = NonNullable<ReturnType<typeof computeWealthSummaryReportModel>>;

export const WealthAnalyticsDetailsSection: React.FC<{
  data: FinancialData;
  reportModel: ReportModel | null | undefined;
  personalTransactions: Transaction[];
  goals: Goal[];
  emergencyFundMonths: number;
  strictReconciliationMode: boolean;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  sarPerUsd: number;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}> = ({
  data,
  reportModel,
  personalTransactions,
  goals,
  emergencyFundMonths,
  strictReconciliationMode,
  kpiSnapshot,
  sarPerUsd,
  setActivePage,
  triggerPageAction,
}) => {
  const { formatCurrencyString } = useFormatCurrency();
  const { maskBalance } = usePrivacyMask();
  const enhancementInsights = useFinancialEnhancementInsights(emergencyFundMonths, { exchangeRate: sarPerUsd });
  const capitalDeployment = enhancementInsights.capitalDeployment;
  const deferredInsights = useWealthAnalyticsDeferredInsights({
    enabled: true,
    data,
    personalTransactions,
    goals,
    emergencyFundMonths,
    strictReconciliationMode,
    reportModel,
    kpiSnapshot,
  });

  return (
    <div className="space-y-4 pt-2">
      {reportModel ? (
        <WealthAnalyticsSummaryPanelsSection
          reportModel={reportModel}
          maskBalance={maskBalance}
          formatCurrencyString={formatCurrencyString}
          nwSnapshotInsight={deferredInsights.nwSnapshotInsight}
          setActivePage={setActivePage}
          triggerPageAction={triggerPageAction}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 animate-pulse min-h-[10rem]" aria-hidden />
      )}

      {strictReconciliationMode && deferredInsights.kpiReconciliation && !deferredInsights.kpiReconciliation.ok && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm" role="alert">
          <p className="font-semibold text-rose-950">KPI mismatch (strict mode)</p>
          <ul className="mt-2 space-y-1 text-rose-900 list-disc pl-4">
            {deferredInsights.kpiReconciliation.rows
              .filter((r) => !r.withinThreshold)
              .map((r) => (
                <li key={r.key}>
                  {r.label}: Dashboard {r.dashboardValue.toFixed(2)} vs Summary {r.summaryValue.toFixed(2)}
                </li>
              ))}
          </ul>
        </div>
      )}

      {deferredInsights.ready && deferredInsights.nextBestActions.length > 0 && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Suggested actions</h3>
          <ul className="space-y-2 text-sm">
            {deferredInsights.nextBestActions.slice(0, 5).map((action) => (
              <li key={action.id} className="flex flex-wrap gap-2">
                <span className="text-slate-700 flex-1">{action.title}</span>
                {action.link && setActivePage && (
                  <button
                    type="button"
                    onClick={() => setActivePage(action.link as Page)}
                    className="text-primary font-medium hover:underline"
                  >
                    {action.linkLabel ?? action.link} →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <EnhancementInsightStrip
        goalConflicts={enhancementInsights.goalConflicts}
        budgetDrift={enhancementInsights.budgetDrift.slice(0, 3)}
        lifestyleHits={enhancementInsights.lifestyleHits}
      />

      {capitalDeployment && (
        <section className="rounded-xl border border-slate-200 overflow-hidden text-sm">
          <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-xs uppercase tracking-wide">
            Can I invest? — {capitalDeployment.canInvest ? 'Ready' : 'Gated'}
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] uppercase text-slate-500">Investable surplus</p>
              <p className="font-bold tabular-nums">
                {formatCurrencyString(capitalDeployment.investableSurplusSar, { digits: 0 })}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Runway</p>
              <p className="font-bold tabular-nums">{capitalDeployment.runwayMonths.toFixed(1)} mo</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Free cash flow</p>
              <p className="font-bold tabular-nums">
                {formatCurrencyString(capitalDeployment.monthlyFreeCashFlowSar, { digits: 0 })}
              </p>
            </div>
          </div>
        </section>
      )}

      {reportModel?.discipline && (
        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-xs font-bold uppercase text-slate-600 mb-2">Budget discipline</h3>
          <p className="text-2xl font-bold tabular-nums mb-1">
            {reportModel.discipline.score}
            <span className="text-sm font-normal text-slate-500">/100</span>
          </p>
          {reportModel.discipline.label && (
            <p className="text-sm text-slate-600">Rating: {reportModel.discipline.label}</p>
          )}
        </section>
      )}

      <CollapsibleSection title="AI executive summary" summary="On-demand narrative" defaultExpanded={false} className="mb-0">
        <AIExecutiveSummarySection />
      </CollapsibleSection>

      <CollapsibleSection title="AI insights feed" summary="Automated signals" defaultExpanded={false} className="mb-0">
        <AIFeedSection />
      </CollapsibleSection>

      <CollapsibleSection title="Multi-stock AI analysis" summary="Arabic/English batch research" defaultExpanded={false} className="mb-0">
        <MultiStockAnalysisSection compact />
      </CollapsibleSection>
    </div>
  );
};

export default WealthAnalyticsDetailsSection;
