import React, { useCallback, useMemo } from 'react';
import PageActionsDropdown from '../PageActionsDropdown';
import { QuotesAsOfBadge } from './QuotesAsOfBadge';
import {
  generateWealthExecutiveSummaryHtml,
  generateWealthMetricPassportHtml,
  openHtmlForPrint,
} from '../../services/reportingEngine';
import {
  buildWealthAnalyticsReportModel,
  WEALTH_METRIC_PASSPORT_LABELS,
  type WealthMetricPassportKey,
} from '../../services/wealthAnalyticsReportModel';
import type { WealthAnalyticsReportModel } from '../../services/wealthAnalyticsReportModel';
import type { FinancialData } from '../../types';
import type { DashboardKpiSnapshot } from '../../services/dashboardKpiSnapshot';
import type { PersonalHeadlineNetWorthResult } from '../../services/personalNetWorth';
import type { WealthSummaryReportInput } from '../../services/reportingEngine';
import type { SimulatedPriceMap } from '../../services/investmentPlatformCardMetrics';
import { useLanguage } from '../../context/LanguageContext';
import PageLanguageToggle from '../PageLanguageToggle';
import { useEmergencyFund } from '../../hooks/useEmergencyFund';

export const WealthAnalyticsExportMenu: React.FC<{
  data: FinancialData;
  wealthSummaryPayload: WealthSummaryReportInput;
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  investmentsTotalSar: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  quotesAsOfIso?: string | null;
  quotesLive?: boolean;
}> = ({
  data,
  wealthSummaryPayload,
  headline,
  kpiSnapshot,
  sarPerUsd,
  simulatedPrices,
  investmentsTotalSar,
  getAvailableCashForAccount,
  quotesAsOfIso,
  quotesLive,
}) => {
  const { t } = useLanguage();
  const emergencyFund = useEmergencyFund(data);

  const exportModel = useMemo(
    (): WealthAnalyticsReportModel =>
      buildWealthAnalyticsReportModel({
        wealthSummaryPayload,
        headline,
        kpiSnapshot,
        emergencyFund,
        data,
        sarPerUsd,
        simulatedPrices,
        investmentsTotalSar,
        getAvailableCashForAccount,
        quotesAsOfIso,
        quotesLive,
      }),
    [
      wealthSummaryPayload,
      headline,
      kpiSnapshot,
      emergencyFund,
      data,
      sarPerUsd,
      simulatedPrices,
      investmentsTotalSar,
      getAvailableCashForAccount,
      quotesAsOfIso,
      quotesLive,
    ],
  );

  const printExecutive = useCallback(() => {
    openHtmlForPrint(generateWealthExecutiveSummaryHtml(exportModel));
  }, [exportModel]);

  const printPassport = useCallback(
    (metric: WealthMetricPassportKey) => {
      openHtmlForPrint(generateWealthMetricPassportHtml(exportModel, metric));
    },
    [exportModel],
  );

  const passportActions = (Object.keys(WEALTH_METRIC_PASSPORT_LABELS) as WealthMetricPassportKey[]).map(
    (key) => ({
      value: `passport-${key}`,
      label: `${t('exportPassportPrefix')} ${WEALTH_METRIC_PASSPORT_LABELS[key]}`,
      onClick: () => printPassport(key),
    }),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 justify-end">
      <PageLanguageToggle />
      <QuotesAsOfBadge />
      <PageActionsDropdown
        label={t('exportLabel')}
        placeholder={t('exportChoose')}
        ariaLabel="Wealth Analytics export"
        actions={[
          { value: 'executive-summary', label: t('exportExecutiveSummary'), onClick: printExecutive },
          ...passportActions,
        ]}
      />
    </div>
  );
};

export default WealthAnalyticsExportMenu;
